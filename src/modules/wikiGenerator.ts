/**
 * Wiki Generator — main orchestrator
 * Extracts PDF text, calls LLM, generates wiki pages
 * Runs in Zotero XUL runtime
 */

import { LLMConfig, PaperMeta, WikiPage } from "../utils/types";
import { getPref } from "../utils/prefs";
import { LLMClient } from "./llmClient";
import { ObsidianWriter } from "./obsidianWriter";

export class WikiGenerator {
  private llm!: LLMClient;
  private writer!: ObsidianWriter;
  private config!: LLMConfig;
  private progressWin: any;

  constructor() {
    // Read config from prefs
    this.config = {
      provider: (getPref("provider") as string) || "minimax",
      apiKey: (getPref("apikey") as string) || "",
      model: (getPref("model") as string) || "",
      baseUrl: (getPref("baseurl") as string) || "",
      maxChars: parseInt(getPref("maxchars") as string) || 12000,
      language: (getPref("language") as "zh" | "en") || "zh",
    };

    if (!this.config.apiKey) {
      throw new Error(
        "API Key not configured. Go to Tools → Zotero Wiki → Preferences",
      );
    }
  }

  /**
   * Main entry point
   * @param mode - selection mode or direct items
   * @param directItems - optional pre-selected items (from MenuManager)
   */
  async run(
    mode: "selected" | "collection",
    directItems?: Zotero.Item[],
  ): Promise<void> {
    this.llm = new LLMClient(this.config);
    this.writer = new ObsidianWriter();

    // Show progress
    this.showProgress("Starting Wiki generation...", 0);

    // 1. Get items
    const items = directItems || (await this.getItems(mode));
    if (items.length === 0) {
      this.showProgress("No items selected.", 100, "error");
      return;
    }
    this.showProgress(`Found ${items.length} items`, 10);

    // 2. Extract metadata + PDF text for each item
    const papers: PaperMeta[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      this.showProgress(
        `Extracting PDF ${i + 1}/${items.length}: ${item.getField("title")?.slice(0, 40)}...`,
        10 + Math.floor((i / items.length) * 30),
      );
      try {
        const meta = await this.extractPaperMeta(item);
        papers.push(meta);
      } catch (e: any) {
        Zotero.debug(`[Wiki] Skip item ${item.id}: ${e.message}`);
      }
    }

    if (papers.length === 0) {
      this.showProgress("No valid papers found.", 100, "error");
      return;
    }
    this.showProgress(`Processing ${papers.length} papers...`, 40);

    // 3. Generate wiki pages via LLM
    const allPages: WikiPage[] = [];

    // Phase A: Generate entity pages (one per paper)
    for (let i = 0; i < papers.length; i++) {
      this.showProgress(
        `Generating wiki page ${i + 1}/${papers.length}...`,
        40 + Math.floor((i / papers.length) * 30),
      );
      try {
        const page = await this.generateEntityPage(papers[i]);
        allPages.push(page);
      } catch (e: any) {
        Zotero.debug(
          `[Wiki] Entity page error for ${papers[i].title}: ${e.message}`,
        );
      }
    }

    // Phase B: Generate concept pages (batch)
    this.showProgress("Generating concept pages...", 72);
    try {
      const conceptPages = await this.generateConceptPages(papers);
      allPages.push(...conceptPages);
    } catch (e: any) {
      Zotero.debug(`[Wiki] Concept pages error: ${e.message}`);
    }

    // Phase C: Generate comparison pages (if >= 2 papers)
    if (papers.length >= 2) {
      this.showProgress("Generating comparison pages...", 85);
      try {
        const compPages = await this.generateComparisonPages(papers);
        allPages.push(...compPages);
      } catch (e: any) {
        Zotero.debug(`[Wiki] Comparison pages error: ${e.message}`);
      }
    }

    // 4. Write to Obsidian
    this.showProgress("Writing to Obsidian vault...", 92);
    await this.writer.writePages(allPages);
    await this.writer.writeIndex(allPages);
    await this.writer.writeLog(`Wiki generation (${mode})`, { pages: allPages });

    // 5. Done
    this.showProgress(
      `Done! ${allPages.length} wiki pages generated.`,
      100,
      "success",
    );
  }

  /**
   * Get items based on mode
   */
  private async getItems(
    mode: "selected" | "collection",
  ): Promise<Zotero.Item[]> {
    const zp = ztoolkit.getGlobal("ZoteroPane");

    if (mode === "collection") {
      const collection = zp.getSelectedCollection();
      if (!collection) throw new Error("No collection selected");
      return collection
        .getChildItems()
        .filter(
          (item: Zotero.Item) =>
            !item.isAttachment() && !item.isNote(),
        );
    }

    // selected mode — get all selected regular items + their child items
    const selected = zp.getSelectedItems();
    const items: Zotero.Item[] = [];
    for (const item of selected) {
      if (item.isRegularItem()) {
        items.push(item);
      }
    }
    return items;
  }

  /**
   * Extract paper metadata + PDF full text
   */
  private async extractPaperMeta(item: Zotero.Item): Promise<PaperMeta> {
    const creators = item.getCreators();
    const authors = creators
      .filter(
        (c: any) =>
          c.creatorTypeID === 1 || c.creatorType === "author",
      )
      .map((c: any) => `${c.firstName || ""} ${c.lastName || ""}`.trim());

    const meta: PaperMeta = {
      itemID: item.id,
      key: item.key,
      title: item.getField("title") || "Untitled",
      authors,
      year: this.extractYear(item.getField("date") || ""),
      journal: item.getField("publicationTitle") || "",
      doi: item.getField("DOI") || "",
      abstract: item.getField("abstractNote") || "",
    };

    // Try to extract PDF text
    meta.pdfText = await this.extractPdfText(item);

    return meta;
  }

  /**
   * Extract PDF full text using Zotero's built-in indexer
   */
  private async extractPdfText(item: Zotero.Item): Promise<string> {
    try {
      const attachmentIDs = item.getAttachments();
      for (const attID of attachmentIDs) {
        const att = Zotero.Items.get(attID);
        if (att.attachmentContentType !== "application/pdf") continue;

        // Method 1: Use Zotero.PDFWorker (preferred)
        try {
          const result = await (Zotero as any).PDFWorker.getFullText(
            att.id,
          );
          if (result?.text) {
            Zotero.debug(
              `[Wiki] PDFWorker extracted ${result.text.length} chars from item ${item.id}`,
            );
            return result.text.slice(0, this.config.maxChars);
          }
        } catch {
          Zotero.debug(
            `[Wiki] PDFWorker failed for item ${item.id}, trying fallback`,
          );
        }

        // Method 2: Read fulltext cache file
        try {
          const cacheFile = (Zotero as any).Fulltext.getItemCacheFile(att);
          if (cacheFile?.exists()) {
            const text = await Zotero.File.getContentsAsync(cacheFile.path);
            if (text) {
              Zotero.debug(
                `[Wiki] Cache file extracted ${String(text).length} chars from item ${item.id}`,
              );
              return String(text).slice(0, this.config.maxChars);
            }
          }
        } catch {
          Zotero.debug(
            `[Wiki] Cache file read failed for item ${item.id}`,
          );
        }

        // Method 3: Read PDF file directly
        try {
          const filePath = await att.getFilePathAsync();
          if (filePath && filePath.endsWith(".pdf")) {
            // Use pdftotext if available, or read raw (limited)
            Zotero.debug(`[Wiki] PDF file path: ${filePath}`);
            // Note: direct text extraction from PDF requires external tool
            // Zotero's PDFWorker is the recommended approach
          }
        } catch {
          // Silently skip
        }

        break; // Only process first PDF
      }
    } catch (e: any) {
      Zotero.debug(`[Wiki] PDF extraction error for item ${item.id}: ${e.message}`);
    }

    return "";
  }

  /**
   * Generate a wiki entity page for one paper
   */
  private async generateEntityPage(paper: PaperMeta): Promise<WikiPage> {
    const lang = this.config.language;
    const textSnippet = paper.pdfText
      ? paper.pdfText.slice(0, this.config.maxChars)
      : "";

    const systemPrompt =
      lang === "zh"
        ? `你是一个学术文献分析助手。根据给定的论文信息，生成一份结构化的Wiki页面。
要求：
- 使用中文输出
- 使用 Obsidian [[wikilinks]] 语法引用相关概念
- YAML frontmatter 包含完整元数据
- 生成一个简洁的文件名（英文，无空格，无特殊字符，以.md结尾）
- 置信度分为 high/medium/low
- 输出纯 Markdown，不要代码块包裹`
        : `You are an academic literature analyst. Generate a structured wiki page from the given paper.
Requirements:
- Use Obsidian [[wikilinks]] for concepts
- YAML frontmatter with full metadata
- Generate a concise filename (English, no spaces, no special chars, ending in .md)
- Confidence: high/medium/low
- Output pure markdown, no code fences`;

    const userPrompt =
      lang === "zh"
        ? `论文信息：
标题: ${paper.title}
作者: ${paper.authors.join(", ")}
年份: ${paper.year}
期刊: ${paper.journal}
DOI: ${paper.doi}
摘要: ${paper.abstract}
${textSnippet ? `\n全文摘录:\n${textSnippet}` : ""}

请生成Wiki页面，格式如下：

---
title: "${paper.title}"
created: ${new Date().toISOString().split("T")[0]}
type: entity
tags: [paper, ...]
authors: [...]
journal: "${paper.journal}"
year: ${paper.year}
doi: "${paper.doi}"
zotero_key: "${paper.key}"
confidence: high/medium/low
---

# ${paper.title}

> **Authors:** ...
> **Journal:** ... | **Year:** ...
> **DOI:** ...
> **Zotero:** [在Zotero中打开](zotero://select/library/items/${paper.key})

## 核心发现
- ...

## 方法
- ...

## 关键结果
- ...

## 与其他研究的关联
- 关联到 [[概念页A]]：...
- 关联到 [[论文B]]：...

## 笔记
- ...

注意：文件名在输出的第一行，格式为：FILENAME: xxx.md`
        : `Paper info:
Title: ${paper.title}
Authors: ${paper.authors.join(", ")}
Year: ${paper.year}
Journal: ${paper.journal}
DOI: ${paper.doi}
Abstract: ${paper.abstract}
${textSnippet ? `\nFull text excerpt:\n${textSnippet}` : ""}

Generate a wiki page with this structure:

---
title: "${paper.title}"
created: ${new Date().toISOString().split("T")[0]}
type: entity
tags: [paper, ...]
authors: [...]
journal: "${paper.journal}"
year: ${paper.year}
doi: "${paper.doi}"
zotero_key: "${paper.key}"
confidence: high/medium/low
---

# ${paper.title}

> **Authors:** ...
> **Journal:** ... | **Year:** ...
> **DOI:** ...
> **Zotero:** [Open in Zotero](zotero://select/library/items/${paper.key})

## Key Findings
- ...

## Methods
- ...

## Key Results
- ...

## Related Research
- Links to [[concept page A]]: ...
- Links to [[paper B]]: ...

## Notes
- ...

Note: The filename goes on the first line as: FILENAME: xxx.md`;

    const response = await this.llm.chat(systemPrompt, userPrompt);
    return this.parseResponse(response, "entity");
  }

  /**
   * Generate concept pages from all papers' summaries
   */
  private async generateConceptPages(papers: PaperMeta[]): Promise<WikiPage[]> {
    const lang = this.config.language;

    // Build a summary of all papers
    const paperSummaries = papers
      .map(
        (p, i) =>
          `${i + 1}. "${p.title}" (${p.year}, ${p.journal})\n   Authors: ${p.authors.join(", ")}\n   Abstract: ${p.abstract?.slice(0, 500) || "N/A"}`,
      )
      .join("\n\n");

    const systemPrompt =
      lang === "zh"
        ? `你是一个学术知识整理助手。根据多篇论文的信息，提取出共同涉及的核心概念/方法/材料，为每个概念生成一个Wiki页面。
规则：
- 只提取在2篇以上论文中出现或相关的概念
- 每个概念页包含：定义、当前研究进展、开放问题、相关概念
- 使用 Obsidian [[wikilinks]] 引用
- 输出纯JSON数组，每个元素有 filename 和 content 字段
- 最多生成5个概念页
- 不要用代码块包裹，直接输出JSON`
        : `You are an academic knowledge organizer. Extract core concepts/methods/materials shared across the papers and generate a wiki page for each.
Rules:
- Only extract concepts relevant to 2+ papers
- Each concept page includes: definition, current progress, open questions, related concepts
- Use Obsidian [[wikilinks]]
- Output pure JSON array with filename and content fields
- Max 5 concept pages
- No code fences, direct JSON`;

    const userPrompt =
      lang === "zh"
        ? `以下是论文列表：\n\n${paperSummaries}\n\n请提取共同概念并生成Wiki页面。输出格式：\n[\n  {"filename": "ConceptName.md", "content": "---\\ntitle: ...\\n---\\n\\n# Concept\\n..."},\n  ...\n]`
        : `Papers:\n\n${paperSummaries}\n\nExtract shared concepts and generate wiki pages. Output format:\n[\n  {"filename": "ConceptName.md", "content": "---\\ntitle: ...\\n---\\n\\n# Concept\\n..."},\n  ...\n]`;

    const response = await this.llm.chat(systemPrompt, userPrompt);
    return this.parseJsonPages(response, "concept");
  }

  /**
   * Generate comparison pages
   */
  private async generateComparisonPages(
    papers: PaperMeta[],
  ): Promise<WikiPage[]> {
    const lang = this.config.language;

    const paperSummaries = papers
      .map(
        (p, i) =>
          `${i + 1}. "${p.title}" (${p.year}, ${p.journal})\n   Key findings: ${p.abstract?.slice(0, 400) || "N/A"}`,
      )
      .join("\n\n");

    const systemPrompt =
      lang === "zh"
        ? `你是一个学术对比分析助手。根据多篇论文，生成1-2个对比分析页面。
对比维度可以包括：方法差异、材料选择、性能指标、理论框架等。
规则：
- 使用 Obsidian [[wikilinks]] 引用论文和概念
- 包含对比表格（Markdown格式）
- 输出纯JSON数组，每个元素有 filename 和 content 字段
- 不要用代码块包裹，直接输出JSON`
        : `You are an academic comparison analyst. Generate 1-2 comparison pages from the papers.
Compare: methods, materials, performance metrics, theoretical frameworks, etc.
Rules:
- Use Obsidian [[wikilinks]]
- Include comparison tables (Markdown)
- Output pure JSON array with filename and content fields
- No code fences, direct JSON`;

    const userPrompt =
      lang === "zh"
        ? `论文列表：\n\n${paperSummaries}\n\n请生成对比分析Wiki页面。输出JSON数组格式。`
        : `Papers:\n\n${paperSummaries}\n\nGenerate comparison wiki pages. Output JSON array format.`;

    const response = await this.llm.chat(systemPrompt, userPrompt);
    return this.parseJsonPages(response, "comparison");
  }

  /**
   * Parse LLM response into a WikiPage (for entity pages)
   */
  private parseResponse(response: string, type: WikiPage["type"]): WikiPage {
    let content = response.trim();

    // Extract filename from first line if present
    let filename = "";
    const fnMatch = content.match(/^FILENAME:\s*(.+\.md)\s*\n/i);
    if (fnMatch) {
      filename = fnMatch[1].trim();
      content = content.slice(fnMatch[0].length).trim();
    }

    // If no filename, generate one from title
    if (!filename) {
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch?.[1] || "Untitled";
      filename = this.sanitizeFilename(title) + ".md";
    }

    return { filename, content, type };
  }

  /**
   * Parse JSON array response for concept/comparison pages
   */
  private parseJsonPages(
    response: string,
    type: WikiPage["type"],
  ): WikiPage[] {
    try {
      // Try to extract JSON from response (LLM might wrap in text)
      let jsonStr = response.trim();

      // Remove code fences if present
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

      // Try to find JSON array
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!arrayMatch) {
        Zotero.debug(`[Wiki] No JSON array found in response`);
        return [];
      }

      const parsed = JSON.parse(arrayMatch[0]) as Array<{
        filename: string;
        content: string;
      }>;

      return parsed.map((item) => ({
        filename: item.filename || this.sanitizeFilename("Concept") + ".md",
        content: item.content || "",
        type,
      }));
    } catch (e: any) {
      Zotero.debug(
        `[Wiki] JSON parse error: ${e.message}\nResponse: ${response.slice(0, 300)}`,
      );

      // Fallback: treat entire response as a single page
      if (response.length > 100) {
        const parsed = this.parseResponse(response, type);
        return [parsed];
      }
      return [];
    }
  }

  /**
   * Create a safe filename from a title
   */
  private sanitizeFilename(title: string): string {
    return title
      .replace(/[<>:"/\\|?*\[\]#^]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }

  /**
   * Extract year from date string
   */
  private extractYear(date: string): string {
    const match = date.match(/(\d{4})/);
    return match?.[1] || "";
  }

  /**
   * Show progress window
   */
  private showProgress(
    text: string,
    progress: number,
    type: "default" | "success" | "error" = "default",
  ) {
    try {
      if (this.progressWin) {
        this.progressWin.close();
      }
      this.progressWin = new ztoolkit.ProgressWindow(
        addon.data.config.addonName,
        { closeOnClick: false, closeTime: -1 },
      )
        .createLine({ text, type, progress })
        .show();
    } catch {
      // Progress window may fail in some contexts
    }
  }
}
