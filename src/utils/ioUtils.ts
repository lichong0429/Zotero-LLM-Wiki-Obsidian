// Re-export Zotero's IOUtils and PathUtils
// These are available globally in Zotero's XUL runtime

export const IOUtils = {
  makeDirectory: async (path: string) => {
    // Use Zotero's internal API
    const dir = Zotero.File.pathToFile(path);
    if (!dir.exists()) {
      dir.create((Components as any).interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
    }
  },
  copy: async (source: string, dest: string) => {
    const sourceFile = Zotero.File.pathToFile(source);
    const destFile = Zotero.File.pathToFile(dest);
    sourceFile.copyTo(destFile.parent, destFile.leafName);
  },
};

export const PathUtils = {
  join: (...parts: string[]) => {
    return parts.join("/").replace(/\/+/g, "/");
  },
};
