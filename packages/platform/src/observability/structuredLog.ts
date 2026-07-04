export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogEntry {
  level: LogLevel;
  message: string;
  tenantId?: string;
  correlationId?: string;
  fields?: Readonly<Record<string, unknown>>;
}

export function structuredLog(entry: StructuredLogEntry): void {
  const payload = {
    ts: new Date().toISOString(),
    ...entry,
  };
  const text = JSON.stringify(payload);
  if (entry.level === 'error') {
    console.error(text);
  } else if (entry.level === 'warn') {
    console.warn(text);
  } else {
    console.log(text);
  }
}
