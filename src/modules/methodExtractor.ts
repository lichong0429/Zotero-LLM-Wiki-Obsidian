/**
 * MethodExtractor — extract research methods from papers
 * Uses rule-based + LLM hybrid approach
 * Supports chemistry/materials science domain
 */

import { LLMConfig } from "../utils/types";
import { LLMClient } from "./llmClient";

export interface ExtractedMethod {
  methodName: string;
  category: string; // "synthesis" | "characterization" | "simulation" | "analysis"
  description: string;
  source: string; // where it was found: "abstract" | "note" | "annotation" | "llm"
}

export class MethodExtractor {
  private llm?: LLMClient;
  private config?: LLMConfig;

  // Domain-specific method keywords for rule-based extraction
  private static METHOD_PATTERNS: Record<string, string[]> = {
    synthesis: [
      "solvothermal", "hydrothermal", "mechanochemical", "electrochemical",
      "sol-gel", "co-precipitation", "CVD", "PVD", "ALD", "MOF",
      "ZIF", "membrane", "coating", "deposition", "growth",
      "synthesis", "preparation", "fabrication", "assembly",
      "self-assembly", "in-situ", "ex-situ", "one-pot",
      "水热", "溶剂热", "机械化学", "电化学", "溶胶凝胶",
      "共沉淀", "化学气相沉积", "原子层沉积", "自组装",
    ],
    characterization: [
      "XRD", "XPS", "SEM", "TEM", "AFM", "STM", "BET",
      "FTIR", "Raman", "NMR", "UV-Vis", "DSC", "TGA",
      "X-ray", "diffraction", "spectroscopy", "microscopy",
      "tomography", "chromatography", "mass spectrometry",
      "X射线", "衍射", "光谱", "显微镜", "色谱", "质谱",
    ],
    simulation: [
      "MD", "molecular dynamics", "DFT", "density functional",
      "Monte Carlo", "finite element", "FEM", "CFD",
      "LAMMPS", "GROMACS", "VASP", "Gaussian", "AMS",
      "分子动力学", "密度泛函", "蒙特卡洛", "有限元",
    ],
    analysis: [
      "machine learning", "deep learning", "neural network",
      "CNN", "RNN", "transformer", "random forest", "SVM",
      "PCA", "clustering", "regression", "classification",
      "机器学习", "深度学习", "神经网络", "随机森林",
    ],
  };

  constructor(config?: LLMConfig) {
    if (config?.apiKey) {
      this.config = config;
      this.llm = new LLMClient(config);
    }
  }

  /**
   * Extract methods from a paper using all available sources
   */
  async extractMethods(item: Zotero.Item): Promise<ExtractedMethod[]> {
    const methods: ExtractedMethod[] = [];

    // 1. Rule-based extraction from abstract
    const abstract = item.getField("abstractNote") as string;
    if (abstract) {
      const abstractMethods = this.ruleBasedExtract(abstract, "abstract");
      methods.push(...abstractMethods);
    }

    // 2. Extract from notes
    const noteIDs = item.getNotes();
    for (const noteID of noteIDs) {
      const note = await Zotero.Items.getAsync(noteID);
      if (!note || !note.isNote()) continue;
      const html = note.getNote();
      if (html) {
        const text = html.replace(/<[^>]+>/g, " ");
        const noteMethods = this.ruleBasedExtract(text, "note");
        methods.push(...noteMethods);
      }
    }

    // 3. Extract from annotations (highlights + comments)
    try {
      const annotations = await Zotero.Annotations.getAnnotationsForItem(item.id);
      for (const ann of annotations) {
        const annText = ann.annotationText || "";
        const annComment = ann.annotationComment || "";
        const combined = annText + " " + annComment;
        if (combined.trim()) {
          const annMethods = this.ruleBasedExtract(combined, "annotation");
          methods.push(...annMethods);
        }
      }
    } catch (e) {
      Zotero.debug(`[MethodExtractor] Annotation read failed: ${e}`);
    }

    // 4. LLM-based extraction (if API key available)
    if (this.llm && methods.length < 3) {
      try {
        const llmMethods = await this.llmExtract(item, methods);
        methods.push(...llmMethods);
      } catch (e) {
        Zotero.debug(`[MethodExtractor] LLM extract failed: ${e}`);
      }
    }

    // Deduplicate by methodName
    const seen = new Set<string>();
    return methods.filter((m) => {
      const key = m.methodName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Rule-based method extraction
   */
  private ruleBasedExtract(text: string, source: string): ExtractedMethod[] {
    const methods: ExtractedMethod[] = [];
    const lowerText = text.toLowerCase();

    for (const [category, keywords] of Object.entries(
      MethodExtractor.METHOD_PATTERNS,
    )) {
      for (const keyword of keywords) {
        const lowerKeyword = keyword.toLowerCase();
        // Match whole word or common suffixes
        const regex = new RegExp(
          `\\b${lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b`,
          "i",
        );
        if (regex.test(lowerText)) {
          // Extract surrounding context (±50 chars)
          const idx = lowerText.indexOf(lowerKeyword);
          const start = Math.max(0, idx - 50);
          const end = Math.min(text.length, idx + keyword.length + 50);
          const context = text.slice(start, end).replace(/\s+/g, " ");

          methods.push({
            methodName: keyword,
            category,
            description: context,
            source,
          });
        }
      }
    }

    return methods;
  }

  /**
   * LLM-based method extraction (fallback when rule-based finds too few)
   */
  private async llmExtract(
    item: Zotero.Item,
    existingMethods: ExtractedMethod[],
  ): Promise<ExtractedMethod[]> {
    if (!this.llm) return [];

    const title = item.getField("title") || "";
    const abstract = item.getField("abstractNote") || "";
    const existing = existingMethods.map((m) => m.methodName).join(", ");

    const systemPrompt = `You are a research method extraction assistant. Extract experimental/computational methods from the given paper abstract. Return ONLY a JSON array.

Categories: synthesis, characterization, simulation, analysis

Return format:
[
  {"methodName": "...", "category": "...", "description": "brief description"}
]

Rules:
- Only return methods NOT already listed: ${existing || "none found yet"}
- Be specific (e.g., "solvothermal synthesis" not just "synthesis")
- Include instrument/software names when mentioned
- Return [] if no new methods found`;

    const userPrompt = `Title: ${title}\nAbstract: ${abstract.slice(0, 800)}`;

    try {
      const response = await this.llm.chat(systemPrompt, userPrompt);
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed)) {
        return parsed.map((m: any) => ({
          methodName: m.methodName || m.name || "Unknown",
          category: m.category || "analysis",
          description: m.description || "",
          source: "llm",
        }));
      }
    } catch (e) {
      Zotero.debug(`[MethodExtractor] LLM parse error: ${e}`);
    }

    return [];
  }

  /**
   * Format methods for export
   */
  static formatMethods(methods: ExtractedMethod[]): string {
    if (methods.length === 0) return "未提取到研究方法";

    const byCategory: Record<string, ExtractedMethod[]> = {};
    for (const m of methods) {
      if (!byCategory[m.category]) byCategory[m.category] = [];
      byCategory[m.category].push(m);
    }

    let result = "";
    const categoryNames: Record<string, string> = {
      synthesis: "🔬 合成方法",
      characterization: "📊 表征手段",
      simulation: "💻 模拟计算",
      analysis: "📈 数据分析",
    };

    for (const [cat, catMethods] of Object.entries(byCategory)) {
      result += `\n### ${categoryNames[cat] || cat}\n\n`;
      for (const m of catMethods) {
        result += `- **${m.methodName}**`;
        if (m.description) {
          result += ` — ${m.description.slice(0, 100)}`;
        }
        result += ` *(来源: ${m.source})*\n`;
      }
    }

    return result;
  }
}
