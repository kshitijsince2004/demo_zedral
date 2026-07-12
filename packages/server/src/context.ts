import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  tenant_id?: string;
  correlation_id?: string;
  user?: {
    id: number;
    username: string;
    roles: string[];
    lineAccess: string[];
  };
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getTenantId(): string | undefined {
  const store = requestContext.getStore();
  return store?.tenant_id;
}

export function getCorrelationId(): string | undefined {
  const store = requestContext.getStore();
  return store?.correlation_id;
}
