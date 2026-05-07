/** Types shared across modules */

export interface LLMConfig {
  provider: string; // minimax, kimi, deepseek, openrouter, openai
  apiKey: string;
  model: string;
  baseUrl: string; // auto-resolved from provider if empty
  maxChars: number;
  language: "zh" | "en";
}

export interface PaperMeta {
  itemID: number;
  key: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  doi: string;
  abstract: string;
  pdfText?: string; // extracted full text
}

export interface WikiPage {
  filename: string; // e.g. "Author-Year-Keyword.md"
  content: string; // full markdown content
  type: "entity" | "concept" | "comparison";
}

export interface WikiIndex {
  pages: Array<{
    filename: string;
    type: string;
    title: string;
    summary: string;
  }>;
}

/** Provider configs: baseUrl + default model */
export const PROVIDER_CONFIGS: Record<
  string,
  { baseUrl: string; defaultModel: string; chatPath: string }
> = {
  minimax: {
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    chatPath: "/chat/completions",
  },
  kimi: {
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-128k",
    chatPath: "/chat/completions",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-pro",
    chatPath: "/chat/completions",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    chatPath: "/chat/completions",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    chatPath: "/chat/completions",
  },
};
