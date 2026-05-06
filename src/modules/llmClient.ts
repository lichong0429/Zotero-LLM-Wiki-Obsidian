/**
 * LLM API Client — supports OpenAI-compatible providers
 * Runs in Zotero XUL runtime, uses Zotero.HTTP.request()
 */

import { LLMConfig, PROVIDER_CONFIGS } from "../utils/types";

export class LLMClient {
  private config: LLMConfig;
  private baseUrl: string;
  private chatPath: string;

  constructor(config: LLMConfig) {
    this.config = config;
    const providerConf =
      PROVIDER_CONFIGS[config.provider] || PROVIDER_CONFIGS["openai"];
    this.baseUrl =
      config.baseUrl && config.baseUrl.trim()
        ? config.baseUrl.replace(/\/+$/, "")
        : providerConf.baseUrl;
    this.chatPath = providerConf.chatPath;
  }

  /**
   * Single chat completion
   */
  async chat(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    return this.chatWithRetry(systemPrompt, userPrompt, 2);
  }

  /**
   * Chat with automatic retry on failure
   */
  async chatWithRetry(
    systemPrompt: string,
    userPrompt: string,
    retries: number = 2,
  ): Promise<string> {
    const url = `${this.baseUrl}${this.chatPath}`;
    const body = {
      model:
        this.config.model ||
        PROVIDER_CONFIGS[this.config.provider]?.defaultModel ||
        "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        Zotero.debug(
          `[Wiki] LLM request attempt ${attempt + 1} to ${url}`,
        );

        const resp = await Zotero.HTTP.request("POST", url, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          responseType: "json",
          timeout: 120000, // 2 min timeout for long completions
        });

        const data = resp.response;
        if (data?.choices?.[0]?.message?.content) {
          return data.choices[0].message.content;
        }

        // Some providers wrap in data
        if (data?.data?.choices?.[0]?.message?.content) {
          return data.data.choices[0].message.content;
        }

        throw new Error(
          `Unexpected response format: ${JSON.stringify(data).slice(0, 200)}`,
        );
      } catch (e: any) {
        Zotero.debug(`[Wiki] LLM error (attempt ${attempt + 1}): ${e.message}`);
        if (attempt === retries) {
          throw new Error(
            `LLM API failed after ${retries + 1} attempts: ${e.message}`,
          );
        }
        // Exponential backoff: 2s, 4s
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }

    throw new Error("LLM API: all attempts exhausted");
  }
}
