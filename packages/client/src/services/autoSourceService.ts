/**
 * AutoSourceService — client wrapper for the `/auto-source` endpoint.
 *
 * Fetches pre-filled fields for a (process, coil) pair from the planning →
 * coil master → grade spec → previous-process hierarchy resolved server-side.
 *
 * Design contract (m1-frontend-remediation design.md → AutoSourceService):
 *   getPrefilledFields(processId, coilNo) => Promise<PrefilledFields>
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 *
 * - 4.1: requests pre-filled fields from the auto-source endpoint.
 * - 4.2: marks which fields are auto-sourced (present in `fields`) vs manual
 *        (absent from `fields`, presented empty for manual entry).
 * - 4.3: every auto-sourced value is exposed as a confirmable, overridable
 *        prefill (`editable` carries the server's override permission).
 * - 4.4: fields the hierarchy cannot source are omitted so the form renders
 *        them empty for manual entry.
 * - 4.5: NO mock coil-data fallback — the service surfaces the real endpoint
 *        result (or the error) and never substitutes fabricated data.
 */

import { apiClient } from '../lib/apiClient';

/** Canonical process codes (matches the design's ProcessCode union). */
export type ProcessCode = 'HRS' | 'PKL' | 'CRM' | '6HI' | 'ANN' | 'SKP' | 'RWD' | 'CRS' | 'CTL' | 'GLV';

/** Hierarchy source that supplied an auto-sourced value. */
export type PrefilledSource =
  | 'planning'
  | 'coil_master'
  | 'grade_spec'
  | 'previous_process';

export interface PrefilledValue {
  value: unknown;
  source: PrefilledSource;
  /** Whether the operator may override the pre-filled value. */
  editable: boolean;
}

export interface PrefilledFields {
  /**
   * Auto-sourced fields keyed by field name. Fields the hierarchy could not
   * source are intentionally absent so the form presents them empty for
   * manual entry (Requirement 4.4).
   */
  fields: Record<string, PrefilledValue>;
}

/** Raw shape returned by the server `/auto-source/:processId/:coilNo` route. */
interface ServerPrefilledField {
  value: unknown;
  source: 'PLANNING' | 'COIL_MASTER' | 'GRADE_SPEC' | 'PREVIOUS_PROCESS' | 'MANUAL';
  isEditable: boolean;
}

interface ServerPrefilledResponse {
  fields?: Record<string, ServerPrefilledField>;
}

/** Maps a server source enum to the client-facing sourced type, or null when manual. */
function mapSource(source: ServerPrefilledField['source']): PrefilledSource | null {
  switch (source) {
    case 'PLANNING':
      return 'planning';
    case 'COIL_MASTER':
      return 'coil_master';
    case 'GRADE_SPEC':
      return 'grade_spec';
    case 'PREVIOUS_PROCESS':
      return 'previous_process';
    case 'MANUAL':
    default:
      return null;
  }
}

/**
 * Normalizes the server response into the design's PrefilledFields shape.
 *
 * Only fields that were actually auto-sourced (a non-MANUAL source carrying a
 * value) become confirmable prefills. MANUAL fields and value-less entries are
 * dropped so the form renders them empty for manual entry (Requirements 4.2, 4.4).
 */
function normalize(response: ServerPrefilledResponse | null | undefined): PrefilledFields {
  const fields: Record<string, PrefilledValue> = {};
  const serverFields = response?.fields ?? {};

  for (const [name, field] of Object.entries(serverFields)) {
    if (!field) continue;
    const source = mapSource(field.source);
    // Skip manual / unsourced fields and any sourced field with no value:
    // these are presented empty for manual entry rather than as prefills.
    if (source === null) continue;
    if (field.value === null || field.value === undefined) continue;

    fields[name] = {
      value: field.value,
      source,
      editable: field.isEditable,
    };
  }

  return { fields };
}

export const autoSourceService = {
  /**
   * Fetches pre-filled fields for a coil/process from `/auto-source`.
   *
   * No mock fallback: network or server errors propagate to the caller
   * (Requirement 4.5). The caller decides how to surface the failure.
   */
  async getPrefilledFields(processId: ProcessCode, coilNo: string): Promise<PrefilledFields> {
    const path = `/auto-source/${encodeURIComponent(processId)}/${encodeURIComponent(coilNo)}`;
    const response = await apiClient.get<ServerPrefilledResponse>(path);
    return normalize(response);
  },
};

export type AutoSourceService = typeof autoSourceService;
