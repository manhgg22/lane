import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  ts: string;
  level: LogLevel;
  context: string;
  laneId?: number;
  stage?: string;
  message: string;
  data?: unknown;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  child(extra: { laneId?: number; stage?: string }): Logger;
}

let _logDir: string | null = null;
let _minLevel: LogLevel = "info";

export function configureLogger(options: {
  dir?: string;
  level?: LogLevel;
}): void {
  if (options.dir) {
    _logDir = options.dir;
    if (!existsSync(_logDir)) mkdirSync(_logDir, { recursive: true });
  }
  if (options.level) _minLevel = options.level;
}

function emit(entry: LogEntry): void {
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[_minLevel]) return;

  const line = JSON.stringify(entry);
  process.stdout.write(line + "\n");

  if (_logDir) {
    const date = entry.ts.slice(0, 10);
    const file = join(_logDir, `harness-${date}.log`);
    appendFileSync(file, line + "\n", "utf-8");
  }
}

export function createLogger(context: string, defaults?: { laneId?: number; stage?: string }): Logger {
  const log = (level: LogLevel, message: string, data?: unknown) => {
    emit({
      ts: new Date().toISOString(),
      level,
      context,
      laneId: defaults?.laneId,
      stage: defaults?.stage,
      message,
      data,
    });
  };

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
    child(extra) {
      return createLogger(context, {
        laneId: extra.laneId ?? defaults?.laneId,
        stage: extra.stage ?? defaults?.stage,
      });
    },
  };
}
