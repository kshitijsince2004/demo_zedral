/**
 * CrewSubForm — inline crew capture slot inside ShiftLogShell.
 *
 * Captures operator identity and role code restricted to the five canonical
 * crew roles. Persists each crew entry through the sync engine associated with
 * the current shift log. Replaces the dead GenericForms.tsx CrewEntryForm.
 *
 * Requirements: 1.2, 5.1, 5.2, 5.3, 5.4
 */

import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { useGloveModeClasses } from '../../hooks/useGloveModeClasses';

// ─── Canonical crew role codes (Requirement 5.2) ──────────────────────────────

export const CREW_ROLES = [
  { code: 'OPERATOR', label: 'Operator' },
  { code: 'CRANE', label: 'Crane Operator' },
  { code: 'HELPER', label: 'Helper' },
  { code: 'ASST', label: 'Assistant' },
  { code: 'MTL', label: 'Material Handler' },
] as const;

export type CrewRoleCode = typeof CREW_ROLES[number]['code'];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrewSubFormProps {
  /** The shift log ID this crew entry is associated with. */
  shiftLogId: string;
}

interface CrewEntry {
  id: string;
  operatorId: string;
  operatorName: string;
  roleCode: CrewRoleCode;
}

type SaveState = 'idle' | 'saving' | 'queued' | 'transmitted' | 'failed';

// ─── Component ────────────────────────────────────────────────────────────────

export function CrewSubForm({ shiftLogId }: CrewSubFormProps) {
  const { inputFieldHeight, saveHeight, controlGap } = useGloveModeClasses();

  const [operatorId, setOperatorId] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [roleCode, setRoleCode] = useState<CrewRoleCode | ''>('');
  const [crewList, setCrewList] = useState<CrewEntry[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shiftLogId) return;
    setLoading(true);
    apiClient
      .get<{ crew: { id: string; operatorId: string; empCode: string; operatorName: string; roleCode: string }[] }>(
        `/crew?shiftLogId=${encodeURIComponent(shiftLogId)}`,
      )
      .then((res) => {
        setCrewList(
          res.crew.map((c) => ({
            id: c.id,
            operatorId: c.empCode || c.operatorId,
            operatorName: c.operatorName,
            roleCode: c.roleCode as CrewRoleCode,
          })),
        );
      })
      .catch(() => setError('Failed to load crew from server.'))
      .finally(() => setLoading(false));
  }, [shiftLogId]);

  const handleAdd = async () => {
    if (!operatorId.trim()) {
      setError('Operator ID is required.');
      return;
    }
    if (!roleCode) {
      setError('Select a role code.');
      return;
    }
    setError(null);
    setSaveState('saving');

    const payload = {
      shiftLogId,
      operatorId: operatorId.trim(),
      roleCode,
    };

    try {
      const res = await apiClient.post<{ id: string }>('/crew', payload);
      setSaveState('transmitted');

      setCrewList((prev) => [
        ...prev,
        {
          id: res.id,
          operatorId: operatorId.trim(),
          operatorName: operatorName.trim(),
          roleCode: roleCode as CrewRoleCode,
        },
      ]);

      // Reset fields
      setOperatorId('');
      setOperatorName('');
      setRoleCode('');
    } catch {
      setSaveState('failed');
      setError('Failed to save crew entry. Please try again.');
    }
  };

  const roleLabelFor = (code: string) =>
    CREW_ROLES.find((r) => r.code === code)?.label ?? code;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider font-medium text-muted-foreground">
          Crew Assignment
        </span>
        {crewList.length > 0 && (
          <span className="text-xs font-medium text-muted-foreground">
            {crewList.length} member{crewList.length !== 1 ? 's' : ''} added
          </span>
        )}
      </div>

      <div className={`p-5 flex flex-col ${controlGap}`}>
        {/* Crew list */}
        {crewList.length > 0 && (
          <div className="flex flex-col gap-2">
            {crewList.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary border border-border"
              >
                <div className="flex flex-col">
                  <span className="text-xs font-medium">
                    {entry.operatorName || entry.operatorId}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {entry.operatorId}
                  </span>
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {roleLabelFor(entry.roleCode)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Operator ID */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Operator ID
          </label>
          <input
            type="text"
            value={operatorId}
            onChange={(e) => {
              setOperatorId(e.target.value);
              setError(null);
              setSaveState('idle');
            }}
            placeholder="e.g. EMP001"
            className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
          />
        </div>

        {/* Operator name (optional) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Name (optional)
          </label>
          <input
            type="text"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            placeholder="Display name"
            className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
          />
        </div>

        {/* Role code — restricted to canonical five (Requirement 5.2) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Role
          </label>
          <select
            value={roleCode}
            onChange={(e) => {
              setRoleCode(e.target.value as CrewRoleCode | '');
              setError(null);
              setSaveState('idle');
            }}
            className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 w-full`}
          >
            <option value="">Select Role…</option>
            {CREW_ROLES.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs font-medium text-destructive flex items-center gap-1">
            ⚠ {error}
          </div>
        )}

        {/* Save status */}
        {loading && (
          <div className="text-xs text-muted-foreground">Loading crew…</div>
        )}

        {(saveState === 'transmitted') && (
          <div className="text-xs font-medium text-success flex items-center gap-1">
            ✓ Crew entry saved
          </div>
        )}

        {/* Add button */}
        <button
          onClick={handleAdd}
          disabled={saveState === 'saving' || !operatorId.trim() || !roleCode}
          className={`${saveHeight} rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {saveState === 'saving' ? '…Saving' : '+ Add Crew Member'}
        </button>
      </div>
    </div>
  );
}
