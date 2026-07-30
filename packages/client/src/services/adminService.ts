/**
 * AdminService — client wrapper for admin endpoints.
 *
 * Covers:
 *   - Master data CRUD + soft-delete  (Requirement 7.1, 7.2)
 *   - Planning / import               (Requirement 7.3, 7.4)
 *   - Users / access                  (Requirement 7.5)
 *
 * All calls go through the central `apiClient` which attaches the bearer token
 * and unwraps the `{ data, meta, errors }` envelope.
 */

import { apiClient, getAuthHeaders } from '../lib/apiClient';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type PpcXlsxSheetType = 'ROLLING' | 'SKIN_PASS' | 'REWINDING' | 'ANNEALING' | 'CTL';

export type PpcPreviewRowStatus =
  | 'new'
  | 'safe-update'
  | 'allocation-protected'
  | 'in-production'
  | 'completed'
  | 'duplicate-in-file'
  | 'duplicate-skipped'
  | 'will-merge';

export interface PpcRollingPreviewRow {
  rowNum: number;
  batchNumber: string;
  planDate: string;
  shiftCode: string;
  machineCode: '6HI' | '4HI' | '2HI';
  subProcess?: 'ROLLING' | 'SKIN_PASS';
  coilNo: string;
  customerName: string;
  gradeCode: string;
  widthMm: number;
  finishThkMm: number;
  inputThkMm: number;
  passTargetThkMm?: number;
  rollingPassNo: number;
  ppcWeightMt: number;
  ppcRerollFlag: boolean;
  destination?: string;
  rollFinish?: string;
  processRouteRaw: string;
  errors: string[];
  selected?: boolean;
  /** Production-safety classification returned by the server during preview. */
  previewStatus: PpcPreviewRowStatus;
  /** When previewStatus is will-merge, the existing batch number that will be updated. */
  mergeTargetBatchNumber?: string;
}

export interface PpcRollingPreviewResult {
  sessionId: string;
  rows: PpcRollingPreviewRow[];
  planDate: string;
  shiftCode: string;
  sheetType?: PpcXlsxSheetType;
  sheetName?: string;
  /** Number of batch_numbers that appear more than once in the uploaded file. */
  duplicatesInFile?: number;
}

export type MasterEntity =
  | 'customer'
  | 'grade'
  | 'surface_finish'
  | 'defect_code'
  | 'stoppage_category'
  | 'stoppage_code'
  | 'operator'
  | 'furnace';

export const MASTER_ENTITIES: MasterEntity[] = [
  'customer',
  'grade',
  'surface_finish',
  'defect_code',
  'stoppage_category',
  'stoppage_code',
  'operator',
  'furnace'
];

export const MASTER_ENTITY_LABELS: Record<MasterEntity, string> = {
  customer: 'Customers',
  grade: 'Grades',
  surface_finish: 'Surface Finishes',
  defect_code: 'Defect Codes',
  stoppage_category: 'Stoppage Categories',
  stoppage_code: 'Stoppage Codes',
  operator: 'Operators',
  furnace: 'Furnaces'
};

/** Maps client entity keys to server `/master-data/:entityType` slugs. */
const MASTER_ENTITY_API_SLUG: Record<MasterEntity, string> = {
  customer: 'customers',
  grade: 'grades',
  surface_finish: 'surface_finishes',
  defect_code: 'defect_codes',
  stoppage_category: 'stoppage_categories',
  stoppage_code: 'stoppage_codes',
  operator: 'operators',
  furnace: 'furnaces',
};

function masterRecordToApi(entity: MasterEntity, record: MasterRecord): Record<string, unknown> {
  const active = record.isActive !== false;
  switch (entity) {
    case 'defect_code':
      return {
        defect_code: record.code.trim(),
        description: (record.description?.trim() || record.name.trim()),
        symbol: (record.symbol as string | undefined)?.trim() || null,
        applies_to: (record.applies_to as string | undefined)?.trim() || 'CRM6',
        is_active: active,
      };
    case 'stoppage_category':
      return {
        category_code: record.code.trim(),
        label: (record.description?.trim() || record.name.trim()),
        is_active: active,
      };
    case 'stoppage_code':
      return {
        stoppage_code: record.code.trim(),
        description: (record.description?.trim() || record.name.trim()),
        is_active: active,
      };
    case 'grade':
      return {
        grade_code: record.code.trim(),
        description: record.description?.trim() || record.name.trim(),
        is_active: active,
      };
    case 'customer':
      return {
        customer_code: record.code.trim(),
        customer_name: record.name.trim(),
        is_active: active,
      };
    case 'operator':
      return {
        emp_code: record.code.trim(),
        full_name: record.name.trim(),
        is_active: active,
      };
    default:
      return { ...record, is_active: active };
  }
}

function masterPath(entity: MasterEntity, suffix = ''): string {
  return `/master-data/${MASTER_ENTITY_API_SLUG[entity]}${suffix}`;
}

export interface MasterRecord {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  [key: string]: unknown;
  is_active: boolean;
}

function normalizeMasterRecord(
  entity: MasterEntity,
  row: Record<string, unknown>,
): MasterRecord {
  const active = row.is_active !== false;
  switch (entity) {
    case 'customer':
      return {
        ...row,
        id: String(row.customer_id ?? row.customer_code ?? ''),
        code: String(row.customer_code ?? ''),
        name: String(row.customer_name ?? ''),
        description: '',
        isActive: active,
        is_active: active,
      };
    case 'grade':
      return {
        ...row,
        id: String(row.grade_code ?? ''),
        code: String(row.grade_code ?? ''),
        name: String(row.grade_code ?? ''),
        description: String(row.description ?? ''),
        isActive: active,
        is_active: active,
      };
    case 'surface_finish':
      return {
        ...row,
        id: String(row.surface_finish ?? ''),
        code: String(row.surface_finish ?? ''),
        name: String(row.surface_finish ?? ''),
        description: String(row.description ?? ''),
        isActive: true,
        is_active: true,
      };
    case 'defect_code':
      return {
        ...row,
        id: String(row.defect_code ?? ''),
        code: String(row.defect_code ?? ''),
        name: String(row.description ?? row.defect_code ?? ''),
        description: String(row.description ?? ''),
        symbol: row.symbol != null ? String(row.symbol) : undefined,
        applies_to: row.applies_to != null ? String(row.applies_to) : 'CRM6',
        isActive: active,
        is_active: active,
      };
    case 'stoppage_category':
      return {
        ...row,
        id: String(row.category_code ?? ''),
        code: String(row.category_code ?? ''),
        name: String(row.category_code ?? ''),
        description: String(row.label ?? ''),
        isActive: active,
        is_active: active,
      };
    case 'stoppage_code':
      return {
        ...row,
        id: String(row.stoppage_code ?? ''),
        code: String(row.stoppage_code ?? ''),
        name: String(row.stoppage_code ?? ''),
        description: String(row.description ?? ''),
        isActive: active,
        is_active: active,
      };
    case 'operator':
      return {
        ...row,
        id: String(row.operator_id ?? row.emp_code ?? ''),
        code: String(row.emp_code ?? ''),
        name: String(row.full_name ?? ''),
        description: '',
        isActive: active,
        is_active: active,
      };
    case 'furnace':
      return {
        ...row,
        id: String(row.furnace_id ?? row.code ?? ''),
        code: String(row.code ?? ''),
        name: String(row.name ?? row.code ?? ''),
        description: String(row.furnace_type ?? ''),
        isActive: true,
        is_active: true,
      };
    default:
      return {
        ...row,
        id: String(row.id ?? ''),
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
        isActive: active,
        is_active: active,
      };
  }
}

// ---------------------------------------------------------------------------
// Import / planning types
// ---------------------------------------------------------------------------

export type ImportSource = 'CSV' | 'SAP';

export type ImportBatchStatus =
  | 'PENDING'
  | 'VALIDATED'
  | 'LOADED'
  | 'FAILED'
  | 'PARTIAL';

export interface ImportBatch {
  id: string;
  source: ImportSource;
  status: ImportBatchStatus;
  /** Total rows in the uploaded file. */
  total_rows: number;
  /** Rows that loaded successfully. */
  loaded_rows: number;
  /** Rows that failed validation or load. */
  error_count: number;
  created_at: string;
  updated_at: string;
  /** Human-readable summary of the first few errors, if any. */
  error_summary?: string;
}

// ---------------------------------------------------------------------------
// User / access types
// ---------------------------------------------------------------------------

import type { UserRole } from '@m1/shared-validation';

export type { UserRole };
export type LineAccessLevel = 'READ' | 'WRITE' | 'APPROVE';
export type UserStatus = 'ACTIVE' | 'DISABLED' | 'LOCKED';

export interface LineAccess {
  line_id: string;
  level: LineAccessLevel;
}

export interface UserAccess {
  id: string;
  username: string;
  display_name: string;
  /** Badge ID used for shop-floor login (maps to emp_code). */
  emp_code?: string;
  /** Set on create/update only; never returned from list API. */
  pin?: string;
  role: UserRole;
  /** Legacy; synced from machine_access on save. */
  line_access?: LineAccess[];
  machine_access?: string[];
  status: UserStatus;
  email?: string;
  password?: string;
}

// ---------------------------------------------------------------------------
// AdminService implementation
// ---------------------------------------------------------------------------

export const adminService = {
  // -------------------------------------------------------------------------
  // Master data
  // -------------------------------------------------------------------------

  async listMaster(
    entity: MasterEntity,
    opts: { includeInactive?: boolean } = {},
  ): Promise<MasterRecord[]> {
    const qs = opts.includeInactive ? '?includeInactive=true' : '';
    const rows = await apiClient.get<Record<string, unknown>[]>(`${masterPath(entity)}${qs}`);
    return rows.map((row) => normalizeMasterRecord(entity, row));
  },

  upsertMaster(entity: MasterEntity, record: MasterRecord): Promise<MasterRecord> {
    const payload = masterRecordToApi(entity, record);
    if (record.id) {
      return apiClient.put<MasterRecord>(`${masterPath(entity)}/${record.id}`, payload);
    }
    return apiClient.post<MasterRecord>(masterPath(entity), payload);
  },

  async setMasterActive(
    entity: MasterEntity,
    id: string,
    isActive: boolean,
  ): Promise<MasterRecord> {
    if (!isActive) {
      await apiClient.delete(`${masterPath(entity)}/${id}`);
      return { id, is_active: false } as MasterRecord;
    }
    await apiClient.put(`${masterPath(entity)}/${id}`, { is_active: true });
    return { id, is_active: true } as MasterRecord;
  },

  // -------------------------------------------------------------------------
  // Planning / import
  // -------------------------------------------------------------------------

  /**
   * Upload a CSV or SAP file to create an import batch.
   * Uses multipart/form-data so we bypass the JSON-only `apiClient.post` helper
   * and call `apiClient.request` directly with no Content-Type override (the
   * browser sets the correct multipart boundary automatically).
   */
  async uploadImport(source: ImportSource, file: File): Promise<ImportBatch> {
    const formData = new FormData();
    formData.append('source', source);
    formData.append('file', file);

    // We need to send multipart, so we call fetch directly via the raw request
    // helper, omitting the Content-Type header so the browser sets the boundary.
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      const msg =
        (parsed && typeof parsed === 'object' && 'error' in (parsed as object)
          ? (parsed as { error: string }).error
          : null) ||
        `Upload failed (${res.status})`;
      throw new Error(msg);
    }

    const json = await res.json();
    // Unwrap envelope if present
    if (json && typeof json === 'object' && 'data' in json) {
      return json.data as ImportBatch;
    }
    return json as ImportBatch;
  },

  /** Upload PPC sheet for 6HI queue (batch_number keyed). */
  async uploadPpc(file: File): Promise<{ batchId: string | null; status: string; loaded: number; errors: { row: number; message: string }[] }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/6hi/import/ppc', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error || `PPC upload failed (${res.status})`);
    }
    return json;
  },

  /** Preview rolling plan XLSX before commit. */
  async previewPpcRolling(
    file: File,
    sheetType: PpcXlsxSheetType = 'ROLLING',
  ): Promise<PpcRollingPreviewResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sheetType', sheetType);
    const res = await fetch('/api/6hi/import/ppc/preview', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.message || json?.error || `Preview failed (${res.status})`);
    }
    return json;
  },

  async updatePpcPreviewMachines(
    sessionId: string,
    assignments: { batchNumber: string; machineCode: '6HI' | '4HI' }[],
  ): Promise<PpcRollingPreviewRow[]> {
    const res = await fetch(`/api/6hi/import/ppc/preview/${sessionId}/machines`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ assignments }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || `Machine update failed (${res.status})`);
    return json.rows;
  },

  async commitPpcRollingPreview(
    sessionId: string,
    batchNumbers?: string[],
  ): Promise<{
    loaded: number;
    updated: number;
    skipped: number;
    skippedDuplicates: number;
    skippedAllocated: number;
    skippedProduction: number;
    skippedCompleted: number;
    errors: { row: number; message: string }[];
    status: string;
    synced?: {
      planDate: string;
      shiftCode: string;
      machines: string[];
      batchNumbers: string[];
    };
  }> {
    const res = await fetch(`/api/6hi/import/ppc/preview/${sessionId}/commit`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(batchNumbers?.length ? { batchNumbers } : {}),
    });
    const json = await res.json();
    if (!res.ok && res.status !== 207) {
      const commitErrors = Array.isArray(json?.errors)
        ? (json.errors as { row: number; message: string }[])
        : [];
      const rowErrors = commitErrors
        .slice(0, 5)
        .map((e) => `Row ${e.row}: ${e.message}`)
        .join('; ');
      const detail = json?.error
        || (rowErrors
          ? `${json?.status ?? 'FAILED'} — 0 loaded. ${rowErrors}${commitErrors.length > 5 ? ` (+${commitErrors.length - 5} more)` : ''}`
          : null)
        || `Commit failed (${res.status})`;
      throw new Error(detail);
    }
    return json;
  },

  async transferPpcMachine(
    batchNumbers: string[],
    targetMachine: '6HI' | '4HI',
  ): Promise<{ results: { batchNumber: string; ok: boolean; error?: string }[] }> {
    const res = await fetch('/api/6hi/orders/transfer-machine', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ batchNumbers, targetMachine }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || `Transfer failed (${res.status})`);
    return json;
  },

  /** Poll a batch by ID to get its current status and error count. */
  getBatch(batchId: string): Promise<ImportBatch> {
    return apiClient.get<ImportBatch>(`/import/${batchId}`);
  },

  /**
   * Download the errored-rows correction file for a PARTIAL or FAILED batch.
   * Returns a Blob so the caller can trigger a browser download.
   */
  async downloadErrorRows(batchId: string): Promise<Blob> {
    const res = await fetch(`/api/import/${batchId}/error-rows`, {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(`Download failed (${res.status})`);
    }
    return res.blob();
  },

  // -------------------------------------------------------------------------
  // Users / access
  // -------------------------------------------------------------------------

  listUsers(): Promise<UserAccess[]> {
    return apiClient.get<UserAccess[]>('/users');
  },

  upsertUser(user: UserAccess): Promise<UserAccess> {
    if (user.id) {
      return apiClient.put<UserAccess>(`/users/${user.id}`, user);
    }
    return apiClient.post<UserAccess>('/users', user);
  },

  updateLineAccess(userId: string, lineAccess: LineAccess[]): Promise<UserAccess> {
    return apiClient.put<UserAccess>(`/users/${userId}/line-access`, { line_access: lineAccess });
  },
};
