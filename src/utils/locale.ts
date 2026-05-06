import { config } from "../../package.json";

export function getString(name: string, args?: Record<string, unknown>) {
  return (
    Zotero.Intl.strings?.[`${config.addonRef}-${name}`] ||
    Zotero.Intl.strings?.[name] ||
    name
  );
}

export function initLocale() {
  // Locale is handled by Fluent (.ftl) files in addon/locale/
}
