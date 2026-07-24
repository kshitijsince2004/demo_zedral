import { apiClient } from '../lib/apiClient';

export interface AuditRecord {
  id: number;
  table_name: string;
  record_id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: number | null;
  timestamp: string;
}

export interface AuditQueryResult {
  records: AuditRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditQueryFilters {
  scope?: string;
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  action?: string;
  q?: string;
  tableName?: string;
  userId?: number;
}

export const auditService = {
  async query(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    const params = new URLSearchParams();
    if (filters.scope) params.set('scope', filters.scope);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.action) params.set('action', filters.action);
    if (filters.q) params.set('q', filters.q);
    if (filters.tableName) params.set('tableName', filters.tableName);
    if (filters.userId != null) params.set('userId', String(filters.userId));

    return apiClient.get<AuditQueryResult>(`/audit?${params.toString()}`);
  },
};
