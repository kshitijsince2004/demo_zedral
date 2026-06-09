import { Request, Response, NextFunction } from 'express';
import { getCorrelationId } from '../context';

export interface ApiError extends Error {
  status?: number;
  type?: string;
  title?: string;
  detail?: string;
  instance?: string;
}

export const rfc7807ErrorHandler = (err: ApiError, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || 500;
  const correlation_id = getCorrelationId() || req.headers['x-correlation-id'] || 'unknown';

  const problem = {
    type: err.type || (status >= 500 ? 'https://errors.zedral.io/internal-error' : 'https://errors.zedral.io/bad-request'),
    title: err.title || (status >= 500 ? 'Internal Server Error' : 'Bad Request'),
    status: status,
    detail: err.detail || err.message,
    instance: err.instance || req.originalUrl,
    correlation_id: correlation_id,
  };

  res.status(status).json(problem);
};

/** Build an RFC-7807 error for Express `next(err)` handlers (does not throw). */
export function createApiError(status: number, detail: string, title?: string, type?: string): ApiError {
  const err: ApiError = new Error(detail);
  err.status = status;
  err.detail = detail;
  if (title) err.title = title;
  if (type) err.type = type;
  return err;
}

// Helper for throwing standard RFC-7807 errors
export function throwApiError(status: number, detail: string, title?: string, type?: string): never {
  throw createApiError(status, detail, title, type);
}
