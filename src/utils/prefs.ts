import { config } from "../../package.json";

export function getPref(key: string): string | number | boolean {
  const fullKey = `${config.prefsPrefix}.${key}`;
  return Zotero.Prefs.get(fullKey, true) ?? "";
}

export function setPref(key: string, value: string | number | boolean) {
  const fullKey = `${config.prefsPrefix}.${key}`;
  Zotero.Prefs.set(fullKey, value, true);
}
