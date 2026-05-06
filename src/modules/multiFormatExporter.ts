/**
 * Multi-Format Exporter — export research in multiple formats
 * Supports: PPT outline, Mind map (Markmap), LaTeX table
 */

import { getPref } from "../utils/prefs";
import { PathUtils, IOUtils } from "../utils/ioUtils";
import { MethodExtractor, ExtractedMethod } from "./methodExtractor";
import { LLMConfig } from "../utils/types";

export type ExportFormat = "ppt" | "mindmap" | "latex";

interface PaperInfo {
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
  abstract: string;
  methods: ExtractedMethod[];
  findings: string[];
}

export class MultiFormatExporter {
  private outputDir: string;

  constructor() {
    this.outputDir = (getPref("wikipath") as string) || "";
    if (!this.outputDir) {
      throw new Error("Wiki output path not configured.");
    }
  }

  /**
   * Export papers in specified format
   */
  async export(
    items: Zotero.Item[],
    format: ExportFormat,
    topic: string,
  ): Promise<void> {
    const papers = await this.extractPaperInfo(items);

    switch (format) {
      case "ppt":
        await this.exportPPT(papers, topic);
        break;
      case "mindmap":
        await this.exportMindmap(papers, topic);
        break;
      case "latex":
        await this.exportLaTeX(papers, topic);
        break;
    }
  }

  /**
   * Extract paper information (with methods)
   */
  private async extractPaperInfo(items: Zotero.Item[]): Promise<PaperInfo[]> {
    const papers: PaperInfo[] = [];

    // Build LLM config for method extraction
    const llmConfig: LLMConfig = {
      provider: (getPref("provider") as string) || "minimax",
      apiKey: (getPref("apikey") as string) || "",
      model: (getPref("model") as string) || "",
      baseUrl: (getPref("baseurl") as string) || "",
      maxChars: parseInt(getPref("maxchars") as string) || 12000,
      language: (getPref("language") as "zh" | "en") || "zh",
    };
    const methodExtractor = new MethodExtractor(llmConfig.apiKey ? llmConfig : undefined);

    for (const item of items) {
      if (item.isNote() || item.isAttachment()) continue;

      const paper: PaperInfo = {
        title: item.getField("title") || "",
        authors: item.getField("firstCreator") || "",
        year: item.getField("date")?.match(/\d{4}/)?.[0] || "",
        journal: item.getField("publicationTitle") || "",
        doi: item.getField("DOI") || "",
        abstract: item.getField("abstractNote") || "",
        methods: [],
        findings: [],
      };

      // Extract methods
      try {
        paper.methods = await methodExtractor.extractMethods(item);
      } catch (e) {
        Zotero.debug(`[MultiFormat] Method extract failed for ${paper.title}: ${e}`);
      }

      papers.push(paper);
    }

    return papers;
  }

  /**
   * Export as PPT outline
   */
  private async exportPPT(papers: PaperInfo[], topic: string): Promise<void> {
    const now = new Date().toISOString().split("T")[0];
    let md = `# ${topic} - 组会汇报\n\n`;
    md += `> 生成时间：${now} | 共 ${papers.length} 篇文献\n\n`;

    // Slide 1: Title
    md += `## 幻灯片 1: 标题页\n\n`;
    md += `**${topic}**\n\n`;
    md += `- 文献调研汇报\n`;
    md += `- ${now}\n\n`;

    // Slide 2: Overview
    md += `## 幻灯片 2: 文献概览\n\n`;
    md += `| 年份 | 第一作者 | 期刊 |\n`;
    md += `|------|----------|------|\n`;
    for (const p of papers) {
      md += `| ${p.year} | ${p.authors.split(",")[0]} | ${p.journal} |\n`;
    }
    md += `\n`;

    // Slides for each paper
    for (let i = 0; i < papers.length; i++) {
      const p = papers[i];
      md += `## 幻灯片 ${i + 3}: ${p.title.slice(0, 50)}...\n\n`;
      md += `**${p.authors} (${p.year})**\n\n`;
      md += `**期刊：** ${p.journal}\n\n`;
      if (p.doi) {
        md += `**DOI：** ${p.doi}\n\n`;
      }
      md += `**摘要要点：**\n`;
      md += `- ${p.abstract.slice(0, 200)}...\n\n`;
    }

    // Final slide
    md += `## 幻灯片 ${papers.length + 3}: 总结与讨论\n\n`;
    md += `### 主要发现\n\n`;
    md += `- [待填写]\n\n`;
    md += `### 未来方向\n\n`;
    md += `- [待填写]\n\n`;

    const filePath = PathUtils.join(this.outputDir, `${topic}_PPT大纲.md`);
    await Zotero.File.putContentsAsync(filePath, md);
    Zotero.debug(`[MultiFormat] PPT outline saved`);
  }

  /**
   * Export as Mind map (Markmap format)
   */
  private async exportMindmap(
    papers: PaperInfo[],
    topic: string,
  ): Promise<void> {
    const now = new Date().toISOString().split("T")[0];

    let md = `# ${topic}\n\n`;

    // Group by year
    const byYear: Record<number, PaperInfo[]> = {};
    for (const p of papers) {
      const year = parseInt(p.year) || 0;
      if (!byYear[year]) byYear[year] = [];
      byYear[year].push(p);
    }

    // Build mind map structure
    for (const year of Object.keys(byYear).sort()) {
      md += `## ${year}年\n\n`;
      for (const p of byYear[parseInt(year)]) {
        md += `### ${p.title.slice(0, 60)}\n\n`;
        md += `- **作者：** ${p.authors}\n`;
        md += `- **期刊：** ${p.journal}\n`;
        if (p.methods.length > 0) {
          md += `- **方法：**\n`;
          for (const m of p.methods.slice(0, 3)) {
            md += `  - ${m.methodName} (${m.category})\n`;
          }
        }
        md += `\n`;
      }
    }

    // Add HTML wrapper for Markmap
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${topic}</title>
  <style>
    svg.markmap { width: 100%; height: 100vh; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/markmap-autocreate"></script>
</head>
<body>
  <div class="markmap">
    <script type="text/template">
      ${md}
    </script>
  </div>
</body>
</html>`;

    const filePath = PathUtils.join(this.outputDir, `${topic}_思维导图.html`);
    await Zotero.File.putContentsAsync(filePath, html);

    // Also save as Markdown
    const mdPath = PathUtils.join(this.outputDir, `${topic}_思维导图.md`);
    await Zotero.File.putContentsAsync(mdPath, md);

    Zotero.debug(`[MultiFormat] Mind map saved`);
  }

  /**
   * Export as LaTeX table
   */
  private async exportLaTeX(
    papers: PaperInfo[],
    topic: string,
  ): Promise<void> {
    const now = new Date().toISOString().split("T")[0];

    let tex = `% ${topic} - Literature Review Table\n`;
    tex += `% Generated: ${now}\n`;
    tex += `% Total papers: ${papers.length}\n\n`;
    tex += `\\documentclass{article}\n`;
    tex += `\\usepackage{booktabs}\n`;
    tex += `\\usepackage{longtable}\n`;
    tex += `\\usepackage{array}\n\n`;
    tex += `\\begin{document}\n\n`;
    tex += `\\begin{longtable}{p{0.3\\textwidth}p{0.15\\textwidth}p{0.1\\textwidth}p{0.35\\textwidth}}\n`;
    tex += `\\caption{${topic}} \\\\\n`;
    tex += `\\toprule\n`;
    tex += `\\textbf{Title} & \\textbf{Authors} & \\textbf{Year} & \\textbf{Journal} \\\\\n`;
    tex += `\\midrule\n`;
    tex += `\\endfirsthead\n\n`;

    for (const p of papers) {
      const title = p.title.replace(/&/g, "\\&").replace(/_/g, "\\_").slice(0, 60);
      const authors = p.authors.replace(/&/g, "\\&").replace(/_/g, "\\_").split(",")[0];
      const journal = p.journal.replace(/&/g, "\\&").replace(/_/g, "\\_");

      tex += `${title} & ${authors} & ${p.year} & ${journal} \\\\\n`;
    }

    tex += `\\bottomrule\n`;
    tex += `\\end{longtable}\n\n`;
    tex += `\\end{document}\n`;

    const filePath = PathUtils.join(this.outputDir, `${topic}_LaTeX表格.tex`);
    await Zotero.File.putContentsAsync(filePath, tex);
    Zotero.debug(`[MultiFormat] LaTeX table saved`);
  }
}
