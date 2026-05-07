import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { PROVIDER_CONFIGS } from "../utils/types";
import * as logger from "../utils/logger";

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = { window: _window };
  } else {
    addon.data.prefs.window = _window;
  }
  bindPrefEvents();
}

function bindPrefEvents() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  const fields = [
    "provider",
    "apikey",
    "model",
    "baseurl",
    "wikipath",
    "maxchars",
    "language",
  ];

  for (const field of fields) {
    const el = doc.querySelector(
      `#zotero-prefpane-${config.addonRef}-${field}`,
    );
    if (!el) continue;

    const tag = el.tagName.toLowerCase();
    const eventType =
      tag === "select" || tag === "menulist" ? "command" : "change";

    // Set initial value from prefs
    const currentVal = getPref(field);
    if (currentVal !== undefined && currentVal !== null) {
      if (tag === "select" || tag === "menulist") {
        (el as HTMLSelectElement).value = String(currentVal);
      } else {
        (el as HTMLInputElement).value = String(currentVal);
      }
    }

    el.addEventListener(eventType, (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      let value: string | number = target.value;
      if (field === "maxchars") {
        value = parseInt(value as string, 10) || 12000;
      }
      setPref(field, value);

      // If provider changed, update model dropdown
      if (field === "provider") {
        updateModelForProvider(doc, value as string);
      }

      // If model changed, show/hide custom model input
      if (field === "model") {
        toggleCustomModelInput(doc, value as string);
      }
    });
  }

  // Initialize custom model input visibility
  const currentModel = (getPref("model") as string) || "";
  toggleCustomModelInput(doc, currentModel);

  // Browse button for wikipath
  const browseBtn = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-browse-btn`,
  );
  if (browseBtn) {
    browseBtn.addEventListener("click", () => {
      browseForFolder(doc);
    });
  }

  // Test connection button
  const testBtn = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-test-btn`,
  );
  if (testBtn) {
    testBtn.addEventListener("click", () => {
      testConnection(doc);
    });
  }

  // Save button
  const saveBtn = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-save-btn`,
  );
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      saveAllPreferences(doc);
    });
  }
}

function browseForFolder(doc: Document) {
  const win = addon.data.prefs?.window;
  if (!win) return;

  // Use Services.prompt for a simple text input as fallback
  // In Zotero 9 / Firefox 128, nsIFilePicker may not be available
  // Use a prompt dialog instead
  const currentPath = (getPref("wikipath") as string) || "";
  const input = { value: currentPath };
  const result = Services.prompt.prompt(
    win,
    "Wiki Generator",
    "请输入 Wiki 输出文件夹路径（例如 E:\\Obsidian\\vault\\wiki）：",
    input,
    null,
    "",
  );

  if (result && input.value) {
    const selectedPath = input.value;
    const inputEl = doc.querySelector(
      `#zotero-prefpane-${config.addonRef}-wikipath`,
    ) as HTMLInputElement;
    if (inputEl) {
      inputEl.value = selectedPath;
    }
    setPref("wikipath", selectedPath);
  }
}

function saveAllPreferences(doc: Document) {
  const fields = [
    "provider",
    "apikey",
    "model",
    "baseurl",
    "wikipath",
    "maxchars",
    "language",
  ];

  for (const field of fields) {
    const el = doc.querySelector(
      `#zotero-prefpane-${config.addonRef}-${field}`,
    ) as HTMLInputElement | HTMLSelectElement;
    if (!el) continue;

    let value: string | number = el.value;
    if (field === "maxchars") {
      value = parseInt(value as string, 10) || 12000;
    }
    setPref(field, value);
  }

  // Also save custom model if visible
  const customModelEl = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-custom-model`,
  ) as HTMLInputElement;
  if (customModelEl && customModelEl.parentElement?.style.display !== "none") {
    setPref("model", customModelEl.value);
  }

  // Show success notification
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 2000,
  })
    .createLine({ text: "参数已保存！", type: "success" })
    .show();
}

function updateModelForProvider(doc: Document, provider: string) {
  const modelEl = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-model`,
  ) as HTMLSelectElement;
  if (!modelEl) return;

  const defaultModels: Record<string, string> = {
    minimax: "MiniMax-Text-01",
    kimi: "kimi-k2.6",
    deepseek: "deepseek-v4-pro",
    openrouter: "anthropic/claude-sonnet-4.6",
    openai: "gpt-5.5-pro",
  };

  const defaultModel = defaultModels[provider] || "gpt-5.5-pro";
  modelEl.value = defaultModel;
  setPref("model", defaultModel);
  toggleCustomModelInput(doc, defaultModel);
}

function toggleCustomModelInput(doc: Document, model: string) {
  const customRow = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-custom-model-row`,
  ) as HTMLElement;
  const customInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-custom-model`,
  ) as HTMLInputElement;
  
  if (!customRow || !customInput) return;

  if (model === "custom") {
    customRow.style.display = "flex";
    customInput.focus();
  } else {
    customRow.style.display = "none";
  }
}

async function testConnection(doc: Document) {
  const provider = (
    doc.querySelector(
      `#zotero-prefpane-${config.addonRef}-provider`,
    ) as HTMLSelectElement
  )?.value;
  const apiKey = (
    doc.querySelector(
      `#zotero-prefpane-${config.addonRef}-apikey`,
    ) as HTMLInputElement
  )?.value;
  let model = (
    doc.querySelector(
      `#zotero-prefpane-${config.addonRef}-model`,
    ) as HTMLSelectElement
  )?.value;
  const baseUrl = (
    doc.querySelector(
      `#zotero-prefpane-${config.addonRef}-baseurl`,
    ) as HTMLInputElement
  )?.value;

  logger.info("Test connection started", { provider, model, hasBaseUrl: !!baseUrl });

  if (!apiKey) {
    logger.warn("Test connection failed: no API key");
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({ text: "请先填写 API Key", type: "error" })
      .show();
    return;
  }

  // If custom model, get from custom input
  if (model === "custom") {
    const customModel = (
      doc.querySelector(
        `#zotero-prefpane-${config.addonRef}-custom-model`,
      ) as HTMLInputElement
    )?.value;
    if (customModel) {
      model = customModel;
      logger.debug("Using custom model", { customModel });
    }
  }

  // Show testing notification
  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({ text: "正在检测模型可用性...", type: "default", progress: 50 })
    .show();

  try {
    const providerConf =
      PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS["openai"];
    const url =
      baseUrl && baseUrl.trim()
        ? `${baseUrl.replace(/\/+$/, "")}${providerConf.chatPath}`
        : `${providerConf.baseUrl}${providerConf.chatPath}`;

    logger.debug("Sending test request", { url, provider, model: model || providerConf.defaultModel });

    const resp = await Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || providerConf.defaultModel,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
      responseType: "json",
      timeout: 30000,
    });

    const data = resp.response;
    Zotero.debug(`[Wiki] Test response: ${JSON.stringify(data).slice(0, 500)}`);
    
    // Accept any valid OpenAI-compatible response structure
    // (some providers return empty content for short prompts with max_tokens=5)
    const hasValidStructure = 
      data?.choices?.[0]?.message !== undefined ||
      data?.data?.choices?.[0]?.message !== undefined ||
      data?.choices?.[0]?.finish_reason !== undefined ||
      data?.choices?.[0]?.text !== undefined ||
      data?.result !== undefined ||
      data?.id !== undefined;  // some providers return { id, model, ... }
    
    if (hasValidStructure) {
      Zotero.debug("[Wiki] Test connection succeeded");
      popupWin.changeLine({
        progress: 100,
        text: "✅ 模型连接正常！",
        type: "success",
      });
      popupWin.startCloseTimer(3000);
      return;
    }
    throw new Error(`返回数据格式异常: ${JSON.stringify(data).slice(0, 200)}`);
  } catch (e: any) {
    logger.error("Test connection failed", e, { provider, model });
    popupWin.changeLine({
      progress: 100,
      text: `❌ 检测失败: ${e.message}`,
      type: "error",
    });
    popupWin.startCloseTimer(5000);
  }
}


