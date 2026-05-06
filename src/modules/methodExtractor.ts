/**
 * MethodExtractor — Direction-aware research method extraction
 * User inputs a research direction, LLM extracts relevant methods from papers
 * Supports dynamic keyword generation + context-aware extraction
 */

import { LLMConfig } from "../utils/types";
import { LLMClient } from "./llmClient";

export interface ExtractedMethod {
  methodName: string;
  category: string;
  description: string;
  source: string; // "abstract" | "note" | "annotation" | "llm"
  relevance: number; // 0-100, how relevant to the research direction
}

export interface DirectionContext {
  direction: string; // user input: "MOF膜气体分离"
  keywords: string[]; // LLM-generated keywords for this direction
  categories: string[]; // expected method categories
}

export class MethodExtractor {
  private llm?: LLMClient;
  private config?: LLMConfig;
  private directionContext?: DirectionContext;

  constructor(config?: LLMConfig) {
    if (config?.apiKey) {
      this.config = config;
      this.llm = new LLMClient(config);
    }
  }

  /**
   * Set research direction — this drives all extractions
   */
  async setDirection(direction: string): Promise<void> {
    this.directionContext = {
      direction,
      keywords: [],
      categories: [],
    };

    // Generate keywords and categories via LLM if available
    if (this.llm) {
      try {
        const context = await this.generateDirectionContext(direction);
        this.directionContext.keywords = context.keywords;
        this.directionContext.categories = context.categories;
      } catch (e) {
        Zotero.debug(`[MethodExtractor] Direction context generation failed: ${e}`);
        // Fallback: use direction as single keyword
        this.directionContext.keywords = [direction];
        this.directionContext.categories = ["相关方法"];
      }
    } else {
      // No LLM: split direction into rough keywords
      this.directionContext.keywords = direction
        .split(/[\s,，、;；]/)
        .filter((k) => k.length > 1);
      this.directionContext.categories = ["相关方法"];
    }

    Zotero.debug(
      `[MethodExtractor] Direction set: "${direction}" with ${this.directionContext.keywords.length} keywords`,
    );
  }

  /**
   * Extract methods from papers based on the set direction
   */
  async extractMethodsFromItems(items: Zotero.Item[]): Promise<{
    direction: string;
    papers: Array<{
      title: string;
      authors: string;
      year: string;
      methods: ExtractedMethod[];
    }>;
    allMethods: ExtractedMethod[];
    summary: string;
  }> {
    if (!this.directionContext) {
      throw new Error("Research direction not set. Call setDirection() first.");
    }

    const direction = this.directionContext.direction;
    const papers: Array<{
      title: string;
      authors: string;
      year: string;
      methods: ExtractedMethod[];
    }> = [];
    let allMethods: ExtractedMethod[] = [];

    // Extract from each paper
    for (const item of items) {
      if (item.isNote() || item.isAttachment()) continue;

      const paperMethods = await this.extractFromSingleItem(item);
      if (paperMethods.length > 0) {
        papers.push({
          title: (item.getField("title") as string) || "",
          authors: (item.getField("firstCreator") as string) || "",
          year: ((item.getField("date") as string)?.match(/\d{4}/)?.[0]) || "",
          methods: paperMethods,
        });
        allMethods.push(...paperMethods);
      }
    }

    // Generate summary via LLM if available
    let summary = "";
    if (this.llm && allMethods.length > 0) {
      try {
        summary = await this.generateDirectionSummary(direction, allMethods);
      } catch (e) {
        Zotero.debug(`[MethodExtractor] Summary generation failed: ${e}`);
      }
    }

    // If no LLM, create a simple summary
    if (!summary) {
      const byCategory: Record<string, number> = {};
      for (const m of allMethods) {
        byCategory[m.category] = (byCategory[m.category] || 0) + 1;
      }
      summary = `从 ${papers.length} 篇文献中提取到 ${allMethods.length} 个与"${direction}"相关的方法。`;
      if (Object.keys(byCategory).length > 0) {
        summary += `\n\n按类别分布：\n`;
        for (const [cat, count] of Object.entries(byCategory)) {
          summary += `- ${cat}: ${count} 个\n`;
        }
      }
    }

    return { direction, papers, allMethods, summary };
  }

  /**
   * Extract methods from a single paper
   */
  private async extractFromSingleItem(item: Zotero.Item): Promise<ExtractedMethod[]> {
    const methods: ExtractedMethod[] = [];

    // Collect all text sources
    const sources: Array<{ text: string; source: string }> = [];

    // 1. Abstract
    const abstract = (item.getField("abstractNote") as string) || "";
    if (abstract) sources.push({ text: abstract, source: "abstract" });

    // 2. Notes
    try {
      const noteIDs = item.getNotes();
      for (const noteID of noteIDs) {
        const note = await Zotero.Items.getAsync(noteID);
        if (!note || !note.isNote()) continue;
        const html = note.getNote();
        if (html) {
          const text = html.replace(/<[^>]+>/g, " ");
          sources.push({ text, source: "note" });
        }
      }
    } catch (e) {
      Zotero.debug(`[MethodExtractor] Note read failed: ${e}`);
    }

    // 3. Annotations
    try {
      const annotations = await Zotero.Annotations.getAnnotationsForItem(item.id);
      for (const ann of annotations) {
        const combined = `${ann.annotationText || ""} ${ann.annotationComment || ""}`.trim();
        if (combined) sources.push({ text: combined, source: "annotation" });
      }
    } catch (e) {
      Zotero.debug(`[MethodExtractor] Annotation read failed: ${e}`);
    }

    // Combine all text
    const fullText = sources.map((s) => s.text).join("\n\n");

    // Extract methods using LLM with direction context
    if (this.llm && fullText.length > 50) {
      try {
        const llmMethods = await this.llmExtractWithDirection(item, fullText);
        methods.push(...llmMethods);
      } catch (e) {
        Zotero.debug(`[MethodExtractor] LLM direction extract failed: ${e}`);
      }
    }

    // Fallback: keyword-based extraction if LLM fails or not available
    if (methods.length === 0 && this.directionContext) {
      for (const source of sources) {
        const keywordMethods = this.keywordExtract(source.text, source.source);
        methods.push(...keywordMethods);
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return methods.filter((m) => {
      const key = `${m.methodName.toLowerCase()}_${m.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * LLM extraction with direction context
   */
  private async llmExtractWithDirection(
    item: Zotero.Item,
    text: string,
  ): Promise<ExtractedMethod[]> {
    if (!this.llm || !this.directionContext) return [];

    const direction = this.directionContext.direction;
    const title = (item.getField("title") as string) || "";

    const systemPrompt = `You are a research method extraction specialist.

Research Direction: "${direction}"

Your task: Extract ALL experimental/computational methods from the paper that are relevant to "${direction}".

Rules:
1. Only extract methods relevant to "${direction}" — ignore unrelated techniques
2. Be specific: "solvothermal synthesis of ZIF-8" not just "synthesis"
3. Include instrument names, software, parameters when mentioned
4. Rate relevance 0-100 based on how central the method is to "${direction}"
5. Categorize methods logically (synthesis, characterization, simulation, etc.)

Return JSON array:
[
  {
    "methodName": "specific method name",
    "category": "category name",
    "description": "brief description with context",
    "relevance": 85
  }
]

Return [] if no relevant methods found.`;

    const userPrompt = `Title: ${title}\n\nText:\n${text.slice(0, 3000)}`;

    try {
      const response = await this.llm.chat(systemPrompt, userPrompt);
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed)) {
        return parsed.map((m: any) => ({
          methodName: m.methodName || m.name || "Unknown",
          category: m.category || "相关方法",
          description: m.description || "",
          source: "llm",
          relevance: Math.min(100, Math.max(0, parseInt(m.relevance) || 50)),
        }));
      }
    } catch (e) {
      Zotero.debug(`[MethodExtractor] LLM parse error: ${e}`);
    }

    return [];
  }

  /**
   * Keyword-based extraction (fallback when no LLM)
   */
  private keywordExtract(text: string, source: string): ExtractedMethod[] {
    if (!this.directionContext) return [];

    const methods: ExtractedMethod[] = [];
    const lowerText = text.toLowerCase();

    for (const keyword of this.directionContext.keywords) {
      const lowerKeyword = keyword.toLowerCase();
      // Find all occurrences
      const regex = new RegExp(
        `[^.!?]*\\b${lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b[^.!?]*[.!?]`,
        "gi",
      );
      const matches = text.match(regex);
      if (matches && matches.length > 0) {
        // Take first match as description
        const context = matches[0].trim().slice(0, 200);
        methods.push({
          methodName: keyword,
          category: this.directionContext.categories[0] || "相关方法",
          description: context,
          source,
          relevance: 50,
        });
      }
    }

    return methods;
  }

  /**
   * Generate direction context (keywords + categories) via LLM
   */
  private async generateDirectionContext(direction: string): Promise<{
    keywords: string[];
    categories: string[];
  }> {
    if (!this.llm) return { keywords: [direction], categories: ["相关方法"] };

    const systemPrompt = `You are a research direction analyzer.

Given a research direction, generate:
1. A list of 10-20 specific technical keywords/methods commonly used in this field
2. A list of 3-5 method categories

Return ONLY JSON:
{
  "keywords": ["keyword1", "keyword2", ...],
  "categories": ["category1", "category2", ...]
}

Example for "MOF membrane gas separation":
{
  "keywords": ["solvothermal synthesis", "interfacial synthesis", "mixed matrix membrane", "gas permeation", "selectivity", "ZIF-8", "UiO-66", "H2/CO2 separation", "thermal stability", "defect engineering"],
  "categories": ["Membrane Fabrication", "Material Synthesis", "Gas Separation Testing", "Characterization", "Performance Optimization"]
}`;

    const userPrompt = `Research direction: "${direction}"`;

    try {
      const response = await this.llm.chat(systemPrompt, userPrompt);
      const parsed = JSON.parse(response);
      return {
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [direction],
        categories: Array.isArray(parsed.categories) ? parsed.categories : ["相关方法"],
      };
    } catch (e) {
      Zotero.debug(`[MethodExtractor] Context generation parse error: ${e}`);
      return { keywords: [direction], categories: ["相关方法"] };
    }
  }

  /**
   * Generate summary of methods for the direction
   */
  private async generateDirectionSummary(
    direction: string,
    methods: ExtractedMethod[],
  ): Promise<string> {
    if (!this.llm) return "";

    const methodsJson = JSON.stringify(
      methods.slice(0, 30).map((m) => ({
        name: m.methodName,
        category: m.category,
        relevance: m.relevance,
      })),
    );

    const systemPrompt = `Summarize the research methods found for a given direction.

Provide:
1. Overall assessment of the field's methodological landscape
2. Most common/important methods
3. Method gaps or emerging trends
4. Brief recommendations

Keep under 300 words. Write in the same language as the direction name.`;

    const userPrompt = `Research direction: "${direction}"\n\nExtracted methods (${methods.length} total):\n${methodsJson}`;

    try {
      return await this.llm.chat(systemPrompt, userPrompt);
    } catch (e) {
      return "";
    }
  }

  /**
   * Export direction extraction results as Markdown
   */
  static exportAsMarkdown(result: {
    direction: string;
    papers: Array<{
      title: string;
      authors: string;
      year: string;
      methods: ExtractedMethod[];
    }>;
    allMethods: ExtractedMethod[];
    summary: string;
  }): string {
    const now = new Date().toISOString().split("T")[0];
    let md = `# ${result.direction} — 研究方法调研\n\n`;
    md += `> 生成时间：${now} | 分析文献：${result.papers.length} 篇 | 提取方法：${result.allMethods.length} 个\n\n`;

    // Summary
    if (result.summary) {
      md += `## 调研总结\n\n${result.summary}\n\n`;
    }

    // Methods by category
    const byCategory: Record<string, ExtractedMethod[]> = {};
    for (const m of result.allMethods) {
      if (!byCategory[m.category]) byCategory[m.category] = [];
      byCategory[m.category].push(m);
    }

    md += `## 方法分类汇总\n\n`;
    for (const [cat, catMethods] of Object.entries(byCategory)) {
      md += `### ${cat} (${catMethods.length}个)\n\n`;
      // Sort by relevance
      catMethods.sort((a, b) => b.relevance - a.relevance);
      for (const m of catMethods) {
        md += `- **${m.methodName}**`;
        if (m.relevance >= 80) md += ` 🔥`;
        else if (m.relevance >= 60) md += ` ⭐`;
        md += `\n`;
        if (m.description) {
          md += `  ${m.description.slice(0, 150)}${m.description.length > 150 ? "..." : ""}\n`;
        }
        md += `  *(相关度: ${m.relevance}%, 来源: ${m.source})*\n\n`;
      }
    }

    // Per-paper breakdown
    md += `## 逐文献方法详情\n\n`;
    for (const paper of result.papers) {
      md += `### ${paper.title}\n\n`;
      md += `**作者：** ${paper.authors} | **年份：** ${paper.year}\n\n`;
      for (const m of paper.methods) {
        md += `- ${m.methodName} (${m.category}, ${m.relevance}%)\n`;
      }
      md += `\n`;
    }

    return md;
  }
}
