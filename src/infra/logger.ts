export enum LogLevel {
  debug = 0,
  info = 1,
  warn = 2,
  error = 3,
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  setLevel(level: LogLevel): void;
}

export function createLogger(tag: string, initialLevel: LogLevel = LogLevel.info): Logger {
  let level = initialLevel;
  const prefix = `[${tag}]`;

  // emit when configured level <= method level (lower number = more verbose)
  return {
    debug(...args) { if (level <= LogLevel.debug) console.debug(prefix, ...args); },
    info(...args)  { if (level <= LogLevel.info)  console.info(prefix, ...args); },
    warn(...args)  { if (level <= LogLevel.warn)  console.warn(prefix, ...args); },
    error(...args) { console.error(prefix, ...args); },
    setLevel(l)    { level = l; },
  };
}
