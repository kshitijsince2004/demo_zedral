import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { useSixHiStore } from '../../store/sixHiStore';
import { useShiftStore } from '../../store/shiftStore';
import { formatShiftDate } from '../../lib/dateFormat';
import {
  adminService,
  type PpcRollingPreviewRow,
  type PpcXlsxSheetType,
} from '../../services/adminService';
import { ZButton } from '../primitives/ZButton';

const SHEET_TYPE_OPTIONS: { value: PpcXlsxSheetType; label: string }[] = [
  { value: 'ROLLING', label: 'Rolling' },
  { value: 'SKIN_PASS', label: 'Skin Pass' },
  { value: 'REWINDING', label: 'Rewinding' },
  { value: 'ANNEALING', label: 'Annealing' },
];

export function PpcRollingImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [sheetType, setSheetType] = useState<PpcXlsxSheetType>('ROLLING');
  const [shiftCode, setShiftCode] = useState('B');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [parsedSheetName, setParsedSheetName] = useState('');
  const [rows, setRows] = useState<PpcRollingPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<{
    loaded: number;
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

  const validRows = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);
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
    try {
      const result = await adminService.previewPpcRolling(file, sheetType, shiftCode);
      setSessionId(result.sessionId);
      setParsedSheetName(result.sheetName ?? '');
      setRows(result.rows);
      setSelected(new Set(result.rows.filter((r) => r.errors.length === 0).map((r) => r.batchNumber)));
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

  const toggleRow = useCallback((batchNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(batchNumber)) next.delete(batchNumber);
      else next.add(batchNumber);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === validRows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(validRows.map((r) => r.batchNumber)));
    }
  }, [selected.size, validRows]);

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-muted-foreground">
        Upload the PPC plan workbook (e.g. ROLLLING PLAN.XLSX or SKINPASS PLAN.XLSX). Choose the sheet type.
        Machine line is optional: <span className="font-mono">PV-Desc</span> or{' '}
        <span className="font-mono">From Work Center</span> (X → 2HI, Y → 4HI, Z → 6HI) when present;
        otherwise rows default to 6HI. Skin-pass sheets use{' '}
        <span className="font-mono">SP thickness</span> / <span className="font-mono">SP Surface Finish</span>.
        Plan date comes from the sheet; shift defaults below when the file has no shift column.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">Sheet to import</label>
          <select
            value={sheetType}
            onChange={(e) => setSheetType(e.target.value as PpcXlsxSheetType)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {SHEET_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Shift (when not in file)</label>
          <select
            value={shiftCode}
            onChange={(e) => setShiftCode(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-muted-foreground
          file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0
          file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground"
      />

      <ZButton variant="accent" fullWidth onClick={handlePreview} disabled={!file || loading}>
        <Upload className="h-4 w-4 mr-2 inline" aria-hidden />
        {loading && !sessionId ? 'Parsing…' : 'Preview import'}
      </ZButton>

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {commitResult && (
        <div className="text-sm space-y-2 rounded-md border border-border p-3">
          <p>
            Sync status: <span className="font-semibold text-success">{commitResult.status}</span>
            {' — '}{commitResult.loaded} batch{commitResult.loaded === 1 ? '' : 'es'} queued to machine orders
          </p>
          {commitResult.synced && commitResult.loaded > 0 && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Plan {commitResult.synced.planDate} · Shift {commitResult.synced.shiftCode}
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
          <div className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1">
            <p>
              Tab: <span className="font-mono">{parsedSheetName || '—'}</span>
              {' · '}
              {validRows.length} valid · {rows.length - validRows.length} with errors · {selected.size} selected
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

          <div className="overflow-auto max-h-96 border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 text-left">
                    <input
                      type="checkbox"
                      checked={selected.size === validRows.length && validRows.length > 0}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="p-2 text-left">Batch</th>
                  <th className="p-2 text-left">Coil</th>
                  <th className="p-2 text-left">Machine</th>
                  <th className="p-2 text-left">Process</th>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-right">Pass</th>
                  <th className="p-2 text-right">Finish</th>
                  <th className="p-2 text-left">Route</th>
                  <th className="p-2 text-left">Errors</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.batchNumber} className="border-t border-border hover:bg-muted/30">
                    <td className="p-2">
                      {row.errors.length === 0 && (
                        <input
                          type="checkbox"
                          checked={selected.has(row.batchNumber)}
                          onChange={() => toggleRow(row.batchNumber)}
                          aria-label={`Select ${row.batchNumber}`}
                        />
                      )}
                    </td>
                    <td className="p-2 font-mono">{row.batchNumber}</td>
                    <td className="p-2 font-mono">{row.coilNo}</td>
                    <td className="p-2">
                      <span className="font-semibold text-foreground">{row.machineCode}</span>
                    </td>
                    <td className="p-2">{row.subProcess ?? 'ROLLING'}</td>
                    <td className="p-2 font-mono">{row.planDate}</td>
                    <td className="p-2 text-right font-mono">{row.rollingPassNo}</td>
                    <td className="p-2 text-right font-mono">{row.finishThkMm}</td>
                    <td className="p-2 font-mono text-[10px]">{row.processRouteRaw}</td>
                    <td className="p-2 text-destructive">{row.errors.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
