import pino from 'pino';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'password',
      'pin',
      'PIN',
      'jwt',
      'JWT_SECRET',
      'token',
      'accessToken',
      'refreshToken',
      'authorization',
      'Authorization',
      'DATABASE_URL',
      'DB_PASSWORD',
      'DB_APP_PASSWORD',
      'DB_MIGRATE_PASSWORD',
      'SUPERTOKENS_API_KEY',
      'SERVICE_TOKEN',
      'req.headers.authorization',
      '*.password',
      '*.pin',
      '*.token',
      '*.accessToken',
      '*.jwt',
    ],
    censor: '[Redacted]',
  },
});

function formatArgs(args: unknown[]): { msg: string; data?: unknown } {
  if (args.length === 0) return { msg: '' };
  if (args.length === 1) {
    const a = args[0];
    if (typeof a === 'string') return { msg: a };
    return { msg: '', data: a };
  }
  const [first, ...rest] = args;
  if (typeof first === 'string') return { msg: first, data: rest.length === 1 ? rest[0] : rest };
  return { msg: '', data: args };
}

/** Structured logger (pino) — same facade as the old console wrapper. */
export const logger = {
  info: (...args: unknown[]) => {
    const { msg, data } = formatArgs(args);
    if (data !== undefined) pinoLogger.info(data, msg || undefined);
    else pinoLogger.info(msg);
  },
  warn: (...args: unknown[]) => {
    const { msg, data } = formatArgs(args);
    if (data !== undefined) pinoLogger.warn(data, msg || undefined);
    else pinoLogger.warn(msg);
  },
  error: (...args: unknown[]) => {
    const { msg, data } = formatArgs(args);
    if (data !== undefined) pinoLogger.error(data, msg || undefined);
    else pinoLogger.error(msg);
  },
  log: (...args: unknown[]) => {
    const { msg, data } = formatArgs(args);
    if (data !== undefined) pinoLogger.info(data, msg || undefined);
    else pinoLogger.info(msg);
  },
};
