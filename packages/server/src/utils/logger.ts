/** Thin stdout logger — keeps startup/job logs off raw console.log. */
export const logger = {
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
  log: (...args: unknown[]) => console.info(...args),
};
