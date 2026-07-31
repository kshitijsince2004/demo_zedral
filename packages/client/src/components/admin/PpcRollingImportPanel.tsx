import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Upload } from 'lucide-react';
import { useSixHiStore } from '../../store/sixHiStore';
import { useShiftStore } from '../../store/shiftStore';
import { formatPlantDate, formatShiftDate } from '../../lib/dateFormat';
import {
  adminService,
  type PpcRollingPreviewRow,
  type PpcXlsxSheetType,
  type PpcPreviewRowStatus,
} from '../../services/adminService';
import { ZButton } from '../primitives/ZButton';

const SHEET_TYPE_OPTIONS: { value: PpcXlsxSheetType; label: string }[] = [
  { value: 'ROLLING', label: 'Rolling' },
  { value: 'SKIN_PASS', label: 'Skin Pass' },
  { value: 'REWINDING', label: 'Rewinding' },
  { value: 'ANNEALING', label: 'Annealing' },
  { value: 'CTL', label: 'Cut-to-Length' },
];

const OP_LABEL = 'block text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground mb-1';
const OP_SELECT =
  'h-11 w-full rounded-sm border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:border-accent/50';

const PREVIEW_STATUS_LABELS: Record<PpcPreviewRowStatus, { label: string; className: string }> = {
  'new':                  { label: 'New',               className: 'bg-success/15 text-success' },
  'safe-update':          { label: 'Safe Update',        className: 'bg-primary/10 text-primary' },
  'allocation-protected': { label: 'Locked',             className: 'bg-warning/15 text-warning' },
  'in-production':        { label: 'In Production',      className: 'bg-destructive/15 text-destructive' },
  'completed':            { label: 'Completed',          className: 'bg-muted text-muted-foreground' },
  'duplicate-in-file':    { label: 'Duplicate',          className: 'bg-destructive/15 text-destructive' },
  'duplicate-skipped':    { label: 'Dup skipped',        className: 'bg-muted text-muted-foreground' },
  'will-merge':           { label: 'Will Merge',         className: 'bg-warning/15 text-warning' },
};

/** Rows that must never be imported — checkboxes disabled, excluded from auto-select */
const DANGEROUS_STATUSES: PpcPreviewRowStatus[] = [
  'in-production',
  'completed',
  'duplicate-in-file',
  'duplicate-skipped',
  'allocation-protected',
];

function isRowImportable(row: PpcRollingPreviewRow): boolean {
  return row.errors.length === 0 && !DANGEROUS_STATUSES.includes(row.previewStatus);
}

export function PpcRollingImportPanel({ lockedSheetType }: { lockedSheetType?: PpcXlsxSheetType } = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [sheetType, setSheetType] = useState<PpcXlsxSheetType>(lockedSheetType ?? 'ROLLING');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [parsedSheetName, setParsedSheetName] = useState('');
  const [rows, setRows] = useState<PpcRollingPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<{
    loaded: number;
    updated: number;
    merged?: number;
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
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [duplicatesInFile, setDuplicatesInFile] = useState(0);

  const validRows = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);
  const importableRows = useMemo(() => rows.filter(isRowImportable), [rows]);
  const machineSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of validRows) {
      counts[r.machineCode] = (counts[r.machineCode] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([m, n]) => `${m}: ${n}`)
      .join(' · ');
  }, [validRows]);

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setCommitResult(null);
    setDuplicatesInFile(0);
    try {
      const result = await adminService.previewPpcRolling(file, sheetType);
      setSessionId(result.sessionId);
      setParsedSheetName(result.sheetName ?? '');
      setRows(result.rows);
      setDuplicatesInFile(result.duplicatesInFile ?? 0);
      // Auto-select only importable rows (new + safe-update)
      setSelected(new Set(result.rows.filter(isRowImportable).map((r) => r.batchNumber)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminService.commitPpcRollingPreview(sessionId, [...selected]);
      setCommitResult(result);
      if (result.status !== 'FAILED') {
        if (result.synced) {
          useShiftStore.setState({
            shiftDate: formatShiftDate(result.synced.planDate),
            shiftCode: result.synced.shiftCode as 'A' | 'B' | 'C',
          });
        }
        useSixHiStore.getState().requestQueueRefresh();
        setSessionId(null);
        setRows([]);
        setSelected(new Set());
        setFile(null);
        setParsedSheetName('');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = useCallback((batchNumber: string, row: PpcRollingPreviewRow) => {
    if (!isRowImportable(row)) return; // silently ignore click on locked rows
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(batchNumber)) next.delete(batchNumber);
      else next.add(batchNumber);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === importableRows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importableRows.map((r) => r.batchNumber)));
    }
  }, [selected.size, importableRows]);

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-muted-foreground">
        Upload the PPC plan workbook (e.g. ROLLLING PLAN.XLSX or SKINPASS PLAN.XLSX). Choose the sheet type.
        Machine line is optional: <span className="font-mono">PV-Desc</span> or{' '}
        <span className="font-mono">From Work Center</span> (X → 2HI, Y → 4HI, Z → 6HI) when present;
        otherwise rows default to 6HI. Skin-pass sheets use{' '}
        <span className="font-mono">SP thickness</span> / <span className="font-mono">SP Surface Finish</span>.
        Plan date comes from the sheet; shift is derived automatically during import.
      </p>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className={OP_LABEL}>Sheet to import</label>
          {lockedSheetType ? (
            <p className={`${OP_SELECT} flex items-center text-sm font-medium`}>Annealing (locked)</p>
          ) : (
            <select
              value={sheetType}
              onChange={(e) => setSheetType(e.target.value as PpcXlsxSheetType)}
              className={OP_SELECT}
            >
              {SHEET_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-muted-foreground
          file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border-0
          file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground"
      />

      <ZButton variant="accent" fullWidth onClick={handlePreview} disabled={!file || loading}>
        <Upload className="h-4 w-4 mr-2 inline" aria-hidden />
        {loading && !sessionId ? 'Parsing…' : 'Preview import'}
      </ZButton>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {commitResult && (
        <div className="text-sm space-y-2 rounded-2xl border border-border bg-secondary/30 p-4">
          <p>
            Import status: <span className="font-semibold text-success">{commitResult.status}</span>
            {' — '}{commitResult.loaded} new · {commitResult.updated ?? 0} updated
            {(commitResult.merged ?? 0) > 0 && (
              <span className="text-warning ml-1">· {commitResult.merged} merged</span>
            )}
            {(commitResult.skipped ?? 0) > 0 && (
              <span className="text-warning ml-1">· {commitResult.skipped} skipped</span>
            )}
          </p>
          {(commitResult.skippedAllocated ?? 0) > 0 && (
            <p className="text-xs text-warning">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              {commitResult.skippedAllocated} batches skipped — already machine-allocated (operationally locked)
            </p>
          )}
          {(commitResult.skippedProduction ?? 0) > 0 && (
            <p className="text-xs text-destructive">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              {commitResult.skippedProduction} batches skipped — currently IN_PROGRESS
            </p>
          )}
          {(commitResult.skippedCompleted ?? 0) > 0 && (
            <p className="text-xs text-destructive">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              {commitResult.skippedCompleted} batches skipped — already COMPLETED
            </p>
          )}
          {commitResult.synced && commitResult.loaded > 0 && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Plan {formatPlantDate(commitResult.synced.planDate)} · Shift {commitResult.synced.shiftCode}
                {commitResult.synced.machines.length > 0 && (
                  <> · Machines: {commitResult.synced.machines.join(', ')}</>
                )}
              </p>
              <p className="flex flex-wrap gap-2 pt-1">
                {commitResult.synced.machines.map((mc) => (
                  <Link
                    key={mc}
                    to={`/${mc.toLowerCase()}?tab=${sheetType === 'SKIN_PASS' ? 'skinpass' : 'rolling'}`}
                    className="text-primary underline hover:no-underline font-medium"
                  >
                    View {mc} queue →
                  </Link>
                ))}
              </p>
            </div>
          )}
          {commitResult.errors.length > 0 && (
            <ul className="text-xs text-destructive max-h-32 overflow-auto">
              {commitResult.errors.map((e) => (
                <li key={e.row}>Row {e.row}: {e.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          {duplicatesInFile > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex gap-2 items-start">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                <strong>{duplicatesInFile} duplicate row{duplicatesInFile === 1 ? '' : 's'}</strong> found in this file.
                The first occurrence of each batch number stays importable; later copies are marked
                &quot;Dup skipped&quot; and excluded from commit.
              </span>
            </div>
          )}
          <div className="text-xs text-muted-foreground rounded-xl border border-border bg-secondary/30 px-4 py-3 space-y-1">
            <p>
              Tab: <span className="font-mono">{parsedSheetName || '—'}</span>
              {' · '}
              {importableRows.length} importable · {rows.length - importableRows.length} blocked · {selected.size} selected
            </p>
            {machineSummary && <p>Machines from sheet: {machineSummary}</p>}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            {sessionId && (
              <ZButton size="sm" variant="accent" onClick={handleCommit} disabled={loading || selected.size === 0}>
                Commit selected ({selected.size})
              </ZButton>
            )}
          </div>

          <div className="overflow-auto max-h-96 border border-border rounded-2xl bg-white shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 sticky top-0">
                <tr className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <th className="p-3 text-left">
                    <input
                      type="checkbox"
                      checked={selected.size === importableRows.length && importableRows.length > 0}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="p-3 text-left">Batch</th>
                  <th className="p-3 text-left">Coil</th>
                  <th className="p-3 text-left">Machine</th>
                  <th className="p-3 text-left">Process</th>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-right">Pass</th>
                  <th className="p-3 text-right">Finish</th>
                  <th className="p-3 text-left">Route</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Errors</th>
                </tr>
              </thead>
              <tbody>
                  {rows.map((row) => {
                    const importable = isRowImportable(row);
                    const status = PREVIEW_STATUS_LABELS[row.previewStatus] ?? PREVIEW_STATUS_LABELS['new'];
                    return (
                      <tr
                        key={row.batchNumber}
                        className={[
                          'border-t border-border transition-colors',
                          importable ? 'hover:bg-secondary' : 'opacity-60',
                        ].join(' ')}
                      >
                        <td className="p-3">
                          {importable && (
                            <input
                              type="checkbox"
                              checked={selected.has(row.batchNumber)}
                              onChange={() => toggleRow(row.batchNumber, row)}
                              aria-label={`Select ${row.batchNumber}`}
                            />
                          )}
                        </td>
                        <td className="p-3 font-mono">{row.batchNumber}</td>
                        <td className="p-3 font-mono">{row.coilNo}</td>
                        <td className="p-3">
                          <span className="font-semibold text-foreground">{row.machineCode}</span>
                        </td>
                        <td className="p-3">{row.subProcess ?? 'ROLLING'}</td>
                        <td className="p-3 font-mono">{formatPlantDate(row.planDate)}</td>
                        <td className="p-3 text-right font-mono">{row.rollingPassNo}</td>
                        <td className="p-3 text-right font-mono">{row.finishThkMm}</td>
                        <td className="p-3 font-mono text-[10px]">{row.processRouteRaw}</td>
                        <td className="p-3">
                          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${status.className}`}>
                            {status.label}
                          </span>
                          {row.previewStatus === 'will-merge' && row.mergeTargetBatchNumber && (
                            <p className="text-[10px] text-warning mt-1">
                              Will update existing batch {row.mergeTargetBatchNumber}
                            </p>
                          )}
                        </td>
                        <td className="p-3 text-destructive">{row.errors.join('; ')}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
