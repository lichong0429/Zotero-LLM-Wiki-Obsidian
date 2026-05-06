import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";

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
