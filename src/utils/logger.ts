export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  SILENT = 5,
}

const levelNames: Record<LogLevel, string> = {
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT',
};

let globalLevel: LogLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

export interface Logger {
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(component: string): Logger {
  const log = (level: LogLevel, msg: string, args: unknown[]) => {
    if (level < globalLevel) return;
    const ts = new Date().toISOString();
    const prefix = `${ts} [${levelNames[level]}] [${component}]`;
    if (args.length > 0) {
      console.log(prefix, msg, ...args);
    } else {
      console.log(prefix, msg);
    }
  };

  return {
    trace: (msg, ...args) => log(LogLevel.TRACE, msg, args),
    debug: (msg, ...args) => log(LogLevel.DEBUG, msg, args),
    info: (msg, ...args) => log(LogLevel.INFO, msg, args),
    warn: (msg, ...args) => log(LogLevel.WARN, msg, args),
    error: (msg, ...args) => log(LogLevel.ERROR, msg, args),
  };
}
