/**
 * Topic Researcher — research a topic from selected papers
 * User inputs a topic, extracts relevant info from papers
 * Outputs as structured Markdown report
 */

import { getPref } from "../utils/prefs";
import { PathUtils, IOUtils } from "../utils/ioUtils";
import { LLMClient } from "./llmClient";
import { MethodExtractor, ExtractedMethod } from "./methodExtractor";
import { LLMConfig } from "../utils/types";

interface ResearchResult {
  topic: string;
  summary: string;
  sections: ResearchSection[];
  references: string[];
  methods: ExtractedMethod[];
}

interface ResearchSection {
  title: string;
  content: string;
  papers: string[];
  methods: ExtractedMethod[];
}

export class TopicResearcher {
  private llm: LLMClient;
  private outputDir: string;
  private language: "zh" | "en";
  private methodExtractor: MethodExtractor;

  constructor(config: LLMConfig) {
    this.llm = new LLMClient(config);
    this.outputDir = (getPref("wikipath") as string) || "";
    this.language = config.language || "zh";
    this.methodExtractor = new MethodExtractor(config.apiKey ? config : undefined);

    if (!this.outputDir) {
      throw new Error("Wiki output path not configured.");
    }
  }

  /**
   * Research a topic from selected papers
   */
  async research(topic: string, items: Zotero.Item[]): Promise<void> {
    // 1. Extract paper info (with methods)
    const papers = await this.extractPaperInfo(items);

    // 2. Collect all methods across papers
    const allMethods: ExtractedMethod[] = [];
    for (const p of papers) {
      allMethods.push(...p.methods);
    }

    // 3. Generate research report via LLM
    const report = await this.generateReport(topic, papers, allMethods);

    // 4. Save to file
    await this.saveReport(report);
  }

  /**
   * Extract paper information (with methods)
   */
  private async extractPaperInfo(
    items: Zotero.Item[],
  ): Promise<Array<{ title: string; authors: string; abstract: string; methods: ExtractedMethod[]; text: string }>> {
    const papers = [];

    for (const item of items) {
      if (item.isNote() || item.isAttachment()) continue;

      // Extract methods for this paper
      let methods: ExtractedMethod[] = [];
      try {
        await this.methodExtractor.setDirection(topic);
        const result = await this.methodExtractor.extractMethodsFromItems([item]);
        methods = result.allMethods;
      } catch (e) {
        Zotero.debug(`[TopicResearch] Method extract failed for ${item.getField("title")}: ${e}`);
      }

      const paper = {
        title: item.getField("title") || "",
        authors: item.getField("firstCreator") || "",
        abstract: item.getField("abstractNote") || "",
        methods,
        text: "",
      };

      papers.push(paper);
    }

    return papers;
  }
  private async generateReport(
    topic: string,
    papers: Array<{ title: string; authors: string; abstract: string; methods: ExtractedMethod[] }>,
    allMethods: ExtractedMethod[],
  ): Promise<ResearchResult> {
    const systemPrompt = this.language === "zh"
      ? `你是一个学术研究助手。请根据用户提供的论文信息，生成一份关于"${topic}"的研究报告。

报告要求：
1. 总结该主题的研究现状
2. 分析主要研究方向和方法
3. 指出关键发现和创新点
4. 提出未来研究方向

请用以下JSON格式返回：
{
  "summary": "总体概述",
  "sections": [
    {
      "title": "章节标题",
      "content": "章节内容",
      "papers": ["相关论文标题"],
      "methods": ["相关方法"]
    }
  ]
}`
      : `You are an academic research assistant. Generate a research report on "${topic}" based on the provided papers.

Requirements:
1. Summarize the research status
2. Analyze main research directions and methods
3. Highlight key findings and innovations
4. Suggest future research directions

Return in this JSON format:
{
  "summary": "Overall summary",
  "sections": [
    {
      "title": "Section title",
      "content": "Section content",
      "papers": ["Related paper titles"],
      "methods": ["Related methods"]
    }
  ]
}`;

    // Build methods summary
    const methodsSummary = allMethods.length > 0
      ? `\n\n已提取的研究方法：\n${allMethods.map(m => `- ${m.methodName} (${m.category})`).join("\n")}`
      : "";

    const papersInfo = papers
      .map((p, i) => `${i + 1}. ${p.title} (${p.authors})\n   摘要: ${p.abstract}${p.methods.length > 0 ? `\n   方法: ${p.methods.map(m => m.methodName).join(", ")}` : ""}`)
      .join("\n\n");

    const userPrompt = `请分析以下论文，生成关于"${topic}"的研究报告：

${papersInfo}${methodsSummary}`;

    let response = "";
    try {
      response = await this.llm.chat(systemPrompt, userPrompt);
      const result = JSON.parse(response);

      return {
        topic,
        summary: result.summary || "",
        sections: (result.sections || []).map((s: any) => ({
          title: s.title || "",
          content: s.content || "",
          papers: s.papers || [],
          methods: [],
        })),
        references: papers.map((p) => p.title),
        methods: allMethods,
      };
    } catch (e: any) {
      // Fallback to simple report if JSON parsing fails
      return {
        topic,
        summary: `关于"${topic}"的研究报告`,
        sections: [
          {
            title: "研究概述",
            content: response || "暂无内容",
            papers: papers.map((p) => p.title),
            methods: [],
          },
        ],
        references: papers.map((p) => p.title),
        methods: allMethods,
      };
    }
  }

  /**
   * Save report to file
   */
  private async saveReport(report: ResearchResult): Promise<void> {
    const now = new Date().toISOString().split("T")[0];
    let md = `# ${report.topic}\n\n`;
    md += `> 研究报告 | 生成时间：${now} | 基于 ${report.references.length} 篇文献\n\n`;

    // Summary
    md += `## 概述\n\n`;
    md += `${report.summary}\n\n`;

    // Methods summary
    if (report.methods.length > 0) {
      md += `## 研究方法汇总\n\n`;
      const byCategory: Record<string, ExtractedMethod[]> = {};
      for (const m of report.methods) {
        if (!byCategory[m.category]) byCategory[m.category] = [];
        byCategory[m.category].push(m);
      }
      for (const [cat, methods] of Object.entries(byCategory)) {
        md += `### ${cat}\n\n`;
        for (const m of methods) {
          md += `- **${m.methodName}**${m.description ? ` — ${m.description}` : ""}\n`;
        }
        md += `\n`;
      }
    }

    // Sections
    for (const section of report.sections) {
      md += `## ${section.title}\n\n`;
      md += `${section.content}\n\n`;

      if (section.papers.length > 0) {
        md += `**相关文献：**\n`;
        for (const paper of section.papers) {
          md += `- ${paper}\n`;
        }
        md += `\n`;
      }
    }

    // References
    md += `## 参考文献\n\n`;
    for (let i = 0; i < report.references.length; i++) {
      md += `${i + 1}. ${report.references[i]}\n`;
    }

    // Save
    const filename = `${report.topic}_研究报告.md`;
    const filePath = PathUtils.join(this.outputDir, filename);
    await Zotero.File.putContentsAsync(filePath, md);
    Zotero.debug(`[TopicResearcher] Report saved: ${filename}`);
  }
}
