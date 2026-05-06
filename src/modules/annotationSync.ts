/**
 * AnnotationSync — sync Zotero annotations to Markdown
 * Exports highlights + comments with color coding
 * Supports 4000+ notes batch export
 */

import { PathUtils, IOUtils } from "../utils/ioUtils";
import { getPref } from "../utils/prefs";

export interface SyncedAnnotation {
  color: string;
  colorName: string;
  text: string;
  comment: string;
  page: number;
  type: string; // "highlight" | "note" | "image"
  date: string;
}

export interface AnnotationGroup {
  paperTitle: string;
  zoteroLink: string;
  annotations: SyncedAnnotation[];
  summary: string;
}

export class AnnotationSync {
  private outputDir: string;

  // Color mapping (Zotero default colors)
  private static COLOR_MAP: Record<string, string> = {
    "#ff6666": "红色",
    "#ff8c19": "橙色",
    "#ffd400": "黄色",
    "#5fb236": "绿色",
    "#2ea8e5": "蓝色",
    "#a28ae5": "紫色",
    "#e56eee": "粉色",
    "#aaaaaa": "灰色",
  };

  constructor() {
    this.outputDir = (getPref("wikipath") as string) || "";
    if (!this.outputDir) {
      throw new Error("Wiki output path not configured.");
    }
  }

  /**
   * Sync annotations from selected items to Markdown
   */
  async syncAnnotations(items: Zotero.Item[]): Promise<void> {
    const groups: AnnotationGroup[] = [];

    for (const item of items) {
      // Skip notes and attachments
      if (item.isNote() || item.isAttachment()) continue;

      const group = await this.extractAnnotations(item);
      if (group.annotations.length > 0) {
        groups.push(group);
      }
    }

    if (groups.length === 0) {
      throw new Error("未找到任何标注");
    }

    // Write individual files per paper
    for (const group of groups) {
      await this.writePaperAnnotations(group);
    }

    // Write combined index
    await this.writeAnnotationIndex(groups);
  }

  /**
   * Extract annotations from a single paper
   */
  private async extractAnnotations(item: Zotero.Item): Promise<AnnotationGroup> {
    const annotations: SyncedAnnotation[] = [];

    try {
      const anns = await Zotero.Annotations.getAnnotationsForItem(item.id);
      for (const ann of anns) {
        const color = ann.annotationColor || "#aaaaaa";
        const synced: SyncedAnnotation = {
          color,
          colorName: AnnotationSync.COLOR_MAP[color] || "默认",
          text: ann.annotationText || "",
          comment: ann.annotationComment || "",
          page: ann.annotationPageLabel
            ? parseInt(ann.annotationPageLabel)
            : 0,
          type: ann.annotationType || "highlight",
          date: ann.dateModified || ann.dateAdded || "",
        };
        annotations.push(synced);
      }
    } catch (e) {
      Zotero.debug(`[AnnotationSync] Failed to read annotations for ${item.id}: ${e}`);
    }

    // Sort by page
    annotations.sort((a, b) => a.page - b.page);

    // Generate summary
    const summary = this.generateSummary(annotations);

    return {
      paperTitle: item.getField("title") || "Untitled",
      zoteroLink: `zotero://select/library/items/${item.key}`,
      annotations,
      summary,
    };
  }

  /**
   * Generate summary of annotations
   */
  private generateSummary(annotations: SyncedAnnotation[]): string {
    const byColor: Record<string, number> = {};
    const withComments = annotations.filter((a) => a.comment.trim()).length;

    for (const ann of annotations) {
      byColor[ann.colorName] = (byColor[ann.colorName] || 0) + 1;
    }

    let summary = `共 ${annotations.length} 条标注`;
    if (withComments > 0) {
      summary += `，其中 ${withComments} 条有批注`;
    }
    summary += "\n\n**颜色分布：**\n";
    for (const [color, count] of Object.entries(byColor)) {
      summary += `- ${color}: ${count} 条\n`;
    }

    return summary;
  }

  /**
   * Write annotations for a single paper
   */
  private async writePaperAnnotations(group: AnnotationGroup): Promise<void> {
    const safeTitle = this.sanitizeFilename(group.paperTitle);
    const filePath = PathUtils.join(
      this.outputDir,
      `annotations_${safeTitle}.md`,
    );

    let md = `# ${group.paperTitle}\n\n`;
    md += `**Zotero链接：** [打开文献](${group.zoteroLink})\n\n`;
    md += `---\n\n`;
    md += `## 标注概览\n\n${group.summary}\n\n`;
    md += `---\n\n`;

    // Group by color
    const byColor: Record<string, SyncedAnnotation[]> = {};
    for (const ann of group.annotations) {
      if (!byColor[ann.colorName]) byColor[ann.colorName] = [];
      byColor[ann.colorName].push(ann);
    }

    for (const [colorName, anns] of Object.entries(byColor)) {
      md += `## ${colorName}标注 (${anns.length})\n\n`;
      for (const ann of anns) {
        md += `### 第 ${ann.page} 页\n\n`;
        if (ann.text) {
          md += `> ${ann.text}\n\n`;
        }
        if (ann.comment) {
          md += `💬 **批注：** ${ann.comment}\n\n`;
        }
        md += `\n`;
      }
    }

    md += `---\n\n*同步时间：${new Date().toISOString().split("T")[0]}*\n`;

    await Zotero.File.putContentsAsync(filePath, md);
    Zotero.debug(`[AnnotationSync] Wrote: annotations_${safeTitle}.md`);
  }

  /**
   * Write combined annotation index
   */
  private async writeAnnotationIndex(groups: AnnotationGroup[]): Promise<void> {
    const now = new Date().toISOString().split("T")[0];
    let md = `# 标注同步索引\n\n`;
    md += `> 同步时间：${now} | 共 ${groups.length} 篇文献 | ${groups.reduce((sum, g) => sum + g.annotations.length, 0)} 条标注\n\n`;

    for (const group of groups) {
      const safeTitle = this.sanitizeFilename(group.paperTitle);
      md += `## [[annotations_${safeTitle}]]\n\n`;
      md += `- 文献：${group.paperTitle}\n`;
      md += `- 标注数：${group.annotations.length}\n`;
      md += `- Zotero：[打开](${group.zoteroLink})\n\n`;
    }

    const indexPath = PathUtils.join(this.outputDir, "标注同步索引.md");
    await Zotero.File.putContentsAsync(indexPath, md);
  }

  /**
   * Export annotations as a research digest (grouped by topic)
   */
  async exportDigest(items: Zotero.Item[], topic: string): Promise<void> {
    const allAnnotations: Array<{
      paper: string;
      zoteroLink: string;
      annotation: SyncedAnnotation;
    }> = [];

    for (const item of items) {
      if (item.isNote() || item.isAttachment()) continue;
      const group = await this.extractAnnotations(item);
      for (const ann of group.annotations) {
        allAnnotations.push({
          paper: group.paperTitle,
          zoteroLink: group.zoteroLink,
          annotation: ann,
        });
      }
    }

    // Sort by color then by paper
    allAnnotations.sort((a, b) => {
      if (a.annotation.colorName !== b.annotation.colorName) {
        return a.annotation.colorName.localeCompare(b.annotation.colorName);
      }
      return a.paper.localeCompare(b.paper);
    });

    const now = new Date().toISOString().split("T")[0];
    let md = `# ${topic} — 标注研读 digest\n\n`;
    md += `> 生成时间：${now} | 基于 ${items.length} 篇文献 | ${allAnnotations.length} 条标注\n\n`;
    md += `---\n\n`;

    // Group by color for digest view
    const byColor: Record<string, typeof allAnnotations> = {};
    for (const entry of allAnnotations) {
      const c = entry.annotation.colorName;
      if (!byColor[c]) byColor[c] = [];
      byColor[c].push(entry);
    }

    for (const [colorName, entries] of Object.entries(byColor)) {
      md += `## ${colorName} 标注 (${entries.length})\n\n`;
      for (const entry of entries) {
        md += `### ${entry.paper} — 第 ${entry.annotation.page} 页\n\n`;
        if (entry.annotation.text) {
          md += `> ${entry.annotation.text}\n\n`;
        }
        if (entry.annotation.comment) {
          md += `💬 ${entry.annotation.comment}\n\n`;
        }
        md += `[打开文献](${entry.zoteroLink})\n\n`;
      }
    }

    const filePath = PathUtils.join(this.outputDir, `${topic}_标注研读.md`);
    await Zotero.File.putContentsAsync(filePath, md);
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }
}
