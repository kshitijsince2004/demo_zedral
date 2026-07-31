import { useCallback, useEffect, useState } from 'react';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';

type Row = {
  batchId: string;
  batchNumber: string;
  coilNo: string;
  customerName: string | null;
  gradeCode: string | null;
  widthMm: number | null;
  thicknessMm: number | null;
  weightMt: number | null;
  suggestedMachine: string | null;
  routeRaw: string | null;
};

/** CRS machine-head assignment board with eligibility. */
export function CrsAssignmentPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [machineCode, setMachineCode] = useState('CRS1');
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiClient.get<{ rows: Row[] }>('/stations/crs/assignment');
    setRows(res.rows ?? []);
  }, []);

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Load failed')); }, [load]);

  async function assign(batchId: string) {
    setError(null);
    setMsg(null);
    try {
      const result = await apiClient.post<{ eligibility: { warnings: string[]; overrideRequired: boolean } }>(
        '/stations/crs/assignment',
        { batchId, machineCode, overrideReason: overrideReason || undefined },
      );
      setMsg(result.eligibility?.warnings?.length
        ? `Assigned with warnings: ${result.eligibility.warnings.join('; ')}`
        : `Assigned to ${machineCode}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      <h1 className="text-lg font-semibold">CRS Order Assignment</h1>
      <div className="flex flex-wrap gap-3 items-end">
        <ZInput label="Target machine" value={machineCode} onChange={(e) => setMachineCode(e.target.value.toUpperCase())} />
        <ZInput label="Override reason (soft warns)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        <ZButton type="button" variant="secondary" onClick={() => void load()}>Refresh</ZButton>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <div className="overflow-x-auto border rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left">
            <tr>
              <th className="p-2">Coil</th>
              <th className="p-2">Batch</th>
              <th className="p-2">Customer</th>
              <th className="p-2">W×T×Wt</th>
              <th className="p-2">Suggested</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.batchId} className="border-t">
                <td className="p-2 font-mono">{r.coilNo}</td>
                <td className="p-2">{r.batchNumber}</td>
                <td className="p-2">{r.customerName ?? '—'}</td>
                <td className="p-2">{r.widthMm ?? '—'}×{r.thicknessMm ?? '—'}×{r.weightMt ?? '—'}</td>
                <td className="p-2">{r.suggestedMachine ?? '—'}</td>
                <td className="p-2">
                  <ZButton type="button" size="sm" onClick={() => void assign(r.batchId)}>Assign</ZButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
