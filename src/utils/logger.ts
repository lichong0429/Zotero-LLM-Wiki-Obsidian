/**
 * Logger — file-based logging with levels, rotation, and PII redaction
 * Uses IOUtils (Zotero 9 / Firefox 128 compatible)
 * Falls back to Zotero.debug if file writing fails
 */

const LOG_DIR = "zotero-wiki-generator/logs";
const MAX_RETENTION_DAYS = 7;

/** Log levels in ascending verbosity */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

/** Current minimum level to record */
let currentLevel: LogLevel = "debug";

/** Whether file logging is available */
let fileLoggingAvailable = true;

/**
 * Redact sensitive information from log messages
 */
function redactSensitive(msg: string): string {
  return msg
    .replace(/\b(sk-[a-zA-Z0-9]{20,})/g, (m) => `sk-****${m.slice(-4)}`)
    .replace(/\b(mk-[a-zA-Z0-9]{20,})/g, (m) => `mk-****${m.slice(-4)}`)
    .replace(/(Bearer\s+)[a-zA-Z0-9\-_\.]+/g, "$1****")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[a-zA-Z0-9\-_\.]+/gi, "$1****")
    .replace(/(password["']?\s*[:=]\s*["']?)[^\s&"']+/gi, "$1****");
}

/**
 * Format a log line
 */
function formatLine(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const now = new Date();
  const time = now.toISOString().replace("T", " ").slice(0, 19);
  let line = `[${time}] [${level.toUpperCase()}] ${message}`;

  if (meta && Object.keys(meta).length > 0) {
    try {
      const metaStr = JSON.stringify(meta);
      line += ` | ${metaStr}`;
    } catch {
      // ignore stringify errors
    }
  }

  return redactSensitive(line);
}

/**
 * Write to Zotero.debug (always works)
 */
function writeToDebug(level: LogLevel, formattedLine: string): void {
  Zotero.debug(`[WikiLogger] ${formattedLine}`);
}

/**
 * Write to file (async, may fail)
 */
async function writeToFile(level: LogLevel, formattedLine: string): Promise<void> {
  if (!fileLoggingAvailable) return;
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  try {
    const zoteroDir = Zotero.getZoteroDirectory().path;
    const logDir = `${zoteroDir}/${LOG_DIR}`;
    const date = new Date().toISOString().slice(0, 10);
    const logFile = `${logDir}/${date}.log`;

    // Ensure directory exists
    try {
      const exists = await IOUtils.exists(logDir);
      if (!exists) {
        await IOUtils.makeDirectory(logDir, { createAncestors: true });
      }
    } catch (dirErr: any) {
      fileLoggingAvailable = false;
      Zotero.debug(`[WikiLogger] File logging disabled: ${dirErr.message}`);
      return;
    }

    // Read existing content
    let existing = "";
    try {
      existing = await IOUtils.readUTF8(logFile);
    } catch {
      // File doesn't exist yet
    }

    // Write new content
    const content = existing ? `${existing}\n${formattedLine}` : formattedLine;
    await IOUtils.writeUTF8(logFile, content, { mode: "overwrite" });
  } catch (e: any) {
    // File write failed, disable file logging for this session
    fileLoggingAvailable = false;
    Zotero.debug(`[WikiLogger] File write failed, using debug only: ${e.message}`);
  }
}

/**
 * Set minimum log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Log a debug message
 */
export async function debug(message: string, meta?: Record<string, unknown>): Promise<void> {
  const line = formatLine("debug", message, meta);
  writeToDebug("debug", line);
  await writeToFile("debug", line);
}

/**
 * Log an info message
 */
export async function info(message: string, meta?: Record<string, unknown>): Promise<void> {
  const line = formatLine("info", message, meta);
  writeToDebug("info", line);
  await writeToFile("info", line);
}

/**
 * Log a warning
 */
export async function warn(message: string, meta?: Record<string, unknown>): Promise<void> {
  const line = formatLine("warn", message, meta);
  writeToDebug("warn", line);
  await writeToFile("warn", line);
}

/**
 * Log an error with optional stack trace
 */
export async function error(message: string, err?: Error | unknown, meta?: Record<string, unknown>): Promise<void> {
  let fullMessage = message;
  if (err instanceof Error) {
    fullMessage += ` | ${err.name}: ${err.message}`;
    if (err.stack) {
      fullMessage += ` | Stack: ${err.stack.split("\n").slice(0, 3).join("; ")}`;
    }
  } else if (err !== undefined) {
    fullMessage += ` | ${String(err)}`;
  }
  const line = formatLine("error", fullMessage, meta);
  writeToDebug("error", line);
  await writeToFile("error", line);
}

/**
 * Initialize logger
 */
export async function initLogger(): Promise<void> {
  writeToDebug("info", "[Logger] Logger initializing...");
  await info("Logger initialized", { level: currentLevel });
}
