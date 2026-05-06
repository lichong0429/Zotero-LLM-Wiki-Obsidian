import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { WikiGenerator } from "./modules/wikiGenerator";
import { NoteExporter } from "./modules/noteExporter";
import { MultiFormatExporter } from "./modules/multiFormatExporter";
import { TopicResearcher } from "./modules/topicResearcher";
import { getPref } from "./utils/prefs";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Register preference pane
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });

  // Register notifier
  const callback = {
    notify: async (
      event: string,
      type: string,
      ids: number[] | string[],
      extraData: { [key: string]: any },
    ) => {
      if (!addon?.data.alive) {
        Zotero.Notifier.unregisterObserver(notifierID);
        return;
      }
    },
  };
  const notifierID = Zotero.Notifier.registerObserver(callback, [
    "tab",
    "item",
  ]);
  Zotero.Plugins.addObserver({
    shutdown: ({ id }) => {
      if (id === addon.data.config.addonID)
        Zotero.Notifier.unregisterObserver(notifierID);
    },
  });

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

  await Zotero.Promise.delay(1000);

  // Register right-click menu items
  registerMenuItems(win);

  popupWin.changeLine({
    progress: 100,
    text: `[100%] ${getString("startup-finish")}`,
  });
  popupWin.startCloseTimer(3000);
}

function registerMenuItems(_win: _ZoteroTypes.MainWindow) {
  const menuIcon = `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;

  // Register menu via Zotero.MenuManager (Zotero 9 native API)
  Zotero.MenuManager.registerMenu({
    menuID: "zoterowiki-main-menu",
    pluginID: addon.data.config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: "zoterowiki-menu-label",
        icon: menuIcon,
        menus: [
          {
            menuType: "menuitem",
            l10nID: "zoterowiki-generate-selected",
            onCommand: (_event, context) => {
              const items = context.items || [];
              onGenerateFromItems(items, "selected");
            },
          },
          {
            menuType: "menuitem",
            l10nID: "zoterowiki-generate-collection",
            onCommand: (_event, context) => {
              const items = context.items || [];
              onGenerateFromItems(items, "collection");
            },
          },
          {
            menuType: "separator",
          },
          {
            menuType: "menuitem",
            l10nID: "zoterowiki-export-notes",
            onCommand: (_event, context) => {
              const items = context.items || [];
              onExportNotesFromItems(items);
            },
          },
          {
            menuType: "separator",
          },
          {
            menuType: "menuitem",
            l10nID: "zoterowiki-export-ppt",
            onCommand: (_event, context) => {
              const items = context.items || [];
              onExportFormatFromItems(items, "ppt");
            },
          },
          {
            menuType: "menuitem",
            l10nID: "zoterowiki-export-mindmap",
            onCommand: (_event, context) => {
              const items = context.items || [];
              onExportFormatFromItems(items, "mindmap");
            },
          },
          {
            menuType: "menuitem",
            l10nID: "zoterowiki-export-latex",
            onCommand: (_event, context) => {
              const items = context.items || [];
              onExportFormatFromItems(items, "latex");
            },
          },
          {
            menuType: "separator",
          },
          {
            menuType: "menuitem",
            l10nID: "zoterowiki-topic-research",
            onCommand: (_event, context) => {
              const items = context.items || [];
              onTopicResearchFromItems(items);
            },
          },
        ],
      },
    ],
  });
}

async function onGenerateFromItems(
  items: Zotero.Item[],
  mode: "selected" | "collection",
) {
  try {
    const generator = new WikiGenerator();
    await generator.run(mode, items);
  } catch (e: any) {
    Zotero.debug(`Wiki Generator error: ${e.message}`);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: `Error: ${e.message}`,
        type: "error",
      })
      .show();
  }
}

async function onExportNotesFromItems(items: Zotero.Item[]) {
  try {
    if (items.length === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({ text: "请先选择文献", type: "error" })
        .show();
      return;
    }

    const exporter = new NoteExporter();
    await exporter.exportNotes(items);

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "笔记导出完成！", type: "default" })
      .show();
  } catch (e: any) {
    Zotero.debug(`Note export error: ${e.message}`);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: `Error: ${e.message}`, type: "error" })
      .show();
  }
}

async function onExportFormatFromItems(
  items: Zotero.Item[],
  format: "ppt" | "mindmap" | "latex",
) {
  try {
    if (items.length === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({ text: "请先选择文献", type: "error" })
        .show();
      return;
    }

    // Prompt for topic
    const topic = await promptForInput("Wiki Generator", "请输入研究主题：", "文献调研");
    if (!topic) return;

    const config = {
      provider: (getPref("provider") as string) || "minimax",
      apiKey: (getPref("apikey") as string) || "",
      model: (getPref("model") as string) || "",
      baseUrl: (getPref("baseurl") as string) || "",
      maxChars: parseInt(getPref("maxchars") as string) || 12000,
      language: (getPref("language") as "zh" | "en") || "zh",
    };

    const exporter = new MultiFormatExporter();
    await exporter.export(items, format, topic);

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: `${format} 导出完成！`, type: "default" })
      .show();
  } catch (e: any) {
    Zotero.debug(`Export error: ${e.message}`);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: `Error: ${e.message}`, type: "error" })
      .show();
  }
}

async function onTopicResearchFromItems(items: Zotero.Item[]) {
  try {
    if (items.length === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({ text: "请先选择文献", type: "error" })
        .show();
      return;
    }

    // Prompt for topic
    const topic = await promptForInput("Wiki Generator", "请输入调研主题：", "");
    if (!topic) return;

    const config = {
      provider: (getPref("provider") as string) || "minimax",
      apiKey: (getPref("apikey") as string) || "",
      model: (getPref("model") as string) || "",
      baseUrl: (getPref("baseurl") as string) || "",
      maxChars: parseInt(getPref("maxchars") as string) || 12000,
      language: (getPref("language") as "zh" | "en") || "zh",
    };

    const researcher = new TopicResearcher(config);
    await researcher.research(topic, items);

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "主题调研完成！", type: "default" })
      .show();
  } catch (e: any) {
    Zotero.debug(`Research error: ${e.message}`);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: `Error: ${e.message}`, type: "error" })
      .show();
  }
}

/**
 * Prompt user for input using Services.prompt
 */
function promptForInput(
  title: string,
  message: string,
  defaultValue: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const input = { value: defaultValue };
    const win = Zotero.getMainWindow();
    if (!win) {
      resolve(null);
      return;
    }
    const result = Services.prompt.prompt(
      win,
      title,
      message,
      input,
      null,
      "",
    );
    resolve(result ? input.value : null);
  });
}

async function onGenerate(mode: "selected" | "collection") {
  try {
    const generator = new WikiGenerator();
    await generator.run(mode);
  } catch (e: any) {
    Zotero.debug(`Wiki Generator error: ${e.message}`);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: `Error: ${e.message}`,
        type: "error",
      })
      .show();
  }
}

async function onExportNotes() {
  try {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    if (items.length === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({ text: "请先选择文献", type: "error" })
        .show();
      return;
    }

    const exporter = new NoteExporter();
    await exporter.exportNotes(items);

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "笔记导出完成！", type: "default" })
      .show();
  } catch (e: any) {
    Zotero.debug(`Note export error: ${e.message}`);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: `Error: ${e.message}`, type: "error" })
      .show();
  }
}

async function onExportFormat(format: "ppt" | "mindmap" | "latex") {
  try {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    if (items.length === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({ text: "请先选择文献", type: "error" })
        .show();
      return;
    }

    // Prompt for topic
    const topic = await new Promise((resolve) => {
    const input = { value: "文献调研" };
    if (Services.prompt.prompt(null, "Wiki Generator", "请输入研究主题：", input, null, {})) {
      resolve(input.value);
    } else {
      resolve(null);
    }
  });
    if (!topic) return;

    const config = {
      provider: (getPref("provider") as string) || "minimax",
      apiKey: (getPref("apikey") as string) || "",
      model: (getPref("model") as string) || "",
      baseUrl: (getPref("baseurl") as string) || "",
      maxChars: parseInt(getPref("maxchars") as string) || 12000,
      language: (getPref("language") as "zh" | "en") || "zh",
    };

    const exporter = new MultiFormatExporter();
    await exporter.export(items, format, topic);

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: `${format} 导出完成！`, type: "default" })
      .show();
  } catch (e: any) {
    Zotero.debug(`Export error: ${e.message}`);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: `Error: ${e.message}`, type: "error" })
      .show();
  }
}

async function onTopicResearch() {
  try {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    if (items.length === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({ text: "请先选择文献", type: "error" })
        .show();
      return;
    }

    // Prompt for topic
    const topic = await new Promise((resolve) => {
    const input = { value: "" };
    if (Services.prompt.prompt(null, "Wiki Generator", "请输入调研主题：", input, null, {})) {
      resolve(input.value);
    } else {
      resolve(null);
    }
  });
    if (!topic) return;

    const config = {
      provider: (getPref("provider") as string) || "minimax",
      apiKey: (getPref("apikey") as string) || "",
      model: (getPref("model") as string) || "",
      baseUrl: (getPref("baseurl") as string) || "",
      maxChars: parseInt(getPref("maxchars") as string) || 12000,
      language: (getPref("language") as "zh" | "en") || "zh",
    };

    const researcher = new TopicResearcher(config);
    await researcher.research(topic, items);

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "主题调研完成！", type: "default" })
      .show();
  } catch (e: any) {
    Zotero.debug(`Research error: ${e.message}`);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: `Error: ${e.message}`, type: "error" })
      .show();
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onGenerate,
  onExportNotes,
  onExportFormat,
  onTopicResearch,
};
