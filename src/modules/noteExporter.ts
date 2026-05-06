/**
 * Note Exporter — batch export Zotero notes to Markdown
 * Preserves images and adds Zotero links
 */

import { getPref } from "../utils/prefs";
import { PathUtils, IOUtils } from "../utils/ioUtils";

interface ExportedNote {
  title: string;
  content: string;
  zoteroLink: string;
  images: string[];
}

export class NoteExporter {
  private outputDir: string;
  private imagesDir: string;

  constructor() {
    this.outputDir = (getPref("wikipath") as string) || "";
    if (!this.outputDir) {
      throw new Error("Wiki output path not configured.");
    }
    this.imagesDir = PathUtils.join(this.outputDir, "images");
  }

  /**
   * Export all notes from selected items
   */
  async exportNotes(items: Zotero.Item[]): Promise<void> {
    // Ensure directories exist
    await this.ensureDir(this.outputDir);
    await this.ensureDir(this.imagesDir);

    const notes: ExportedNote[] = [];

    for (const item of items) {
      // Get child notes
      const noteIDs = item.getNotes();
      for (const noteID of noteIDs) {
        const note = await Zotero.Items.getAsync(noteID);
        if (!note || !note.isNote()) continue;

        const exported = await this.processNote(note, item);
        if (exported) {
          notes.push(exported);
        }
      }
    }

    // Write notes to files
    for (const note of notes) {
      await this.writeNote(note);
    }

    // Generate index
    await this.writeIndex(notes);
  }

  /**
   * Process a single note
   */
  private async processNote(
    note: Zotero.Item,
    parentItem: Zotero.Item,
  ): Promise<ExportedNote | null> {
    const html = note.getNote();
    if (!html || html.trim() === "") return null;

    // Extract title from first line or parent item
    const title = this.extractTitle(html, parentItem);

    // Generate Zotero link
    const zoteroLink = `zotero://select/library/items/${note.key}`;

    // Process images
    const images = await this.processImages(html, note);

    // Convert HTML to Markdown
    const markdown = this.htmlToMarkdown(html, zoteroLink, parentItem);

    return {
      title,
      content: markdown,
      zoteroLink,
      images,
    };
  }

  /**
   * Extract title from HTML or parent item
   */
  private extractTitle(html: string, parentItem: Zotero.Item): string {
    // Try to get title from first <h1>, <h2>, or first line
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    if (h1Match) return h1Match[1].trim();

    const h2Match = html.match(/<h2[^>]*>([^<]+)<\/h2>/);
    if (h2Match) return h2Match[1].trim();

    // Get first line of text
    const textContent = html.replace(/<[^>]+>/g, "").trim();
    const firstLine = textContent.split("\n")[0].trim();
    if (firstLine.length > 0 && firstLine.length < 100) {
      return firstLine;
    }

    // Fallback to parent item title
    return parentItem.getField("title") || "Untitled Note";
  }

  /**
   * Process images in HTML
   */
  private async processImages(
    html: string,
    note: Zotero.Item,
  ): Promise<string[]> {
    const images: string[] = [];
    const imgRegex = /<img[^>]+src="([^"]+)"/g;
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      if (src.startsWith("storage:")) {
        const filename = src.replace("storage:", "");
        const storageDir = Zotero.Attachments.getStorageDirectory(note);
        const sourcePath = PathUtils.join(storageDir.path, filename);
        const destPath = PathUtils.join(this.imagesDir, filename);

        try {
          await IOUtils.copy(sourcePath, destPath);
          images.push(filename);
        } catch (e: any) {
          Zotero.debug(`[NoteExporter] Failed to copy image: ${e.message}`);
        }
      }
    }

    return images;
  }

  /**
   * Convert HTML to Markdown
   */
  private htmlToMarkdown(
    html: string,
    zoteroLink: string,
    parentItem: Zotero.Item,
  ): string {
    const title = parentItem.getField("title");
    const authors = parentItem.getField("firstCreator");
    const year = parentItem.getField("date")?.match(/\d{4}/)?.[0] || "";

    let md = `# ${title}\n\n`;
    md += `**来源：** ${authors} (${year})\n`;
    md += `**Zotero链接：** [打开笔记](${zoteroLink})\n\n`;
    md += `---\n\n`;

    // Convert HTML to Markdown (basic conversion)
    let content = html
      // Remove Zotero note wrapper
      .replace(/<div class="zotero-note[^"]*">/g, "")
      .replace(/<\/div>/g, "\n")
      // Headers
      .replace(/<h1[^>]*>([^<]+)<\/h1>/g, "# $1\n\n")
      .replace(/<h2[^>]*>([^<]+)<\/h2>/g, "## $1\n\n")
      .replace(/<h3[^>]*>([^<]+)<\/h3>/g, "### $1\n\n")
      // Bold and italic
      .replace(/<strong>([^<]+)<\/strong>/g, "**$1**")
      .replace(/<b>([^<]+)<\/b>/g, "**$1**")
      .replace(/<em>([^<]+)<\/em>/g, "*$1*")
      .replace(/<i>([^<]+)<\/i>/g, "*$1*")
      // Links
      .replace(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g, "[$2]($1)")
      // Images
      .replace(
        /<img[^>]+src="storage:([^"]+)"[^>]*>/g,
        "![](images/$1)",
      )
      .replace(/<img[^>]+src="([^"]+)"[^>]*>/g, "![]($1)")
      // Lists
      .replace(/<li>([^<]+)<\/li>/g, "- $1\n")
      .replace(/<ul>/g, "")
      .replace(/<\/ul>/g, "\n")
      .replace(/<ol>/g, "")
      .replace(/<\/ol>/g, "\n")
      // Paragraphs
      .replace(/<p>([^<]+)<\/p>/g, "$1\n\n")
      // Line breaks
      .replace(/<br\s*\/?>/g, "\n")
      // Remove remaining HTML tags
      .replace(/<[^>]+>/g, "")
      // Clean up extra whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    md += content;
    md += `\n\n---\n\n*导出时间：${new Date().toISOString().split("T")[0]}*\n`;

    return md;
  }

  /**
   * Write note to file
   */
  private async writeNote(note: ExportedNote): Promise<void> {
    const filename = this.sanitizeFilename(note.title) + ".md";
    const filePath = PathUtils.join(this.outputDir, filename);

    await Zotero.File.putContentsAsync(filePath, note.content);
    Zotero.debug(`[NoteExporter] Wrote: ${filename}`);
  }

  /**
   * Write index file
   */
  private async writeIndex(notes: ExportedNote[]): Promise<void> {
    const now = new Date().toISOString().split("T")[0];
    let md = `# 笔记导出索引\n\n`;
    md += `> 导出时间：${now} | 共 ${notes.length} 条笔记\n\n`;

    for (const note of notes) {
      const filename = this.sanitizeFilename(note.title);
      md += `- [[${filename}]] - ${note.title}\n`;
    }

    const indexPath = PathUtils.join(this.outputDir, "笔记索引.md");
    await Zotero.File.putContentsAsync(indexPath, md);
  }

  /**
   * Sanitize filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
  }

  /**
   * Ensure directory exists
   */
  private async ensureDir(path: string): Promise<void> {
    try {
      await IOUtils.makeDirectory(path);
    } catch (e: any) {
      if (e.name !== "NS_ERROR_FILE_ALREADY_EXISTS") {
        throw e;
      }
    }
  }
}
