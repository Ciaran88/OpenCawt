import { randomUUID } from "node:crypto";

const levelRank = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
} as const;

export type LogLevel = keyof typeof levelRank;

export interface Logger {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

export function createRequestId(): string {
  return randomUUID();
}

export function createLogger(minLevel: LogLevel): Logger {
  const write = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (levelRank[level] < levelRank[minLevel]) {
      return;
    }
    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(fields ?? {})
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    debug(message, fields) {
      write("debug", message, fields);
    },
    info(message, fields) {
      write("info", message, fields);
    },
    warn(message, fields) {
      write("warn", message, fields);
    },
    error(message, fields) {
      write("error", message, fields);
    }
  };
}
