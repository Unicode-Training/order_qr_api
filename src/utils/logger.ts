type Level = 'debug' | 'info' | 'warn' | 'error';

const isTest = process.env.NODE_ENV === 'test';

function log(level: Level, message: string, meta?: unknown): void {
  if (isTest && level !== 'error') return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const args = meta === undefined ? [line] : [line, meta];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);
}

export const logger = {
  debug: (message: string, meta?: unknown) => log('debug', message, meta),
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  error: (message: string, meta?: unknown) => log('error', message, meta),
};
