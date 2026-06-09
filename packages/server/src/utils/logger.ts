import { getTenantId, getCorrelationId } from '../context';

/**
 * A basic structured logger that automatically enriches log lines 
 * with the ambient tenant_id and correlation_id.
 */
class Logger {
  private formatLog(level: string, message: string, meta: Record<string, any> = {}) {
    return JSON.stringify({
      level,
      message,
      tenant_id: getTenantId() || 'system',
      correlation_id: getCorrelationId() || 'system',
      component: 'm1-digital-data-collection',
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  info(message: string, meta?: Record<string, any>) {
    console.log(this.formatLog('INFO', message, meta));
  }

  error(message: string, meta?: Record<string, any>) {
    console.error(this.formatLog('ERROR', message, meta));
  }

  warn(message: string, meta?: Record<string, any>) {
    console.warn(this.formatLog('WARN', message, meta));
  }
}

export const logger = new Logger();
