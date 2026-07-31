import { useCallback, useEffect, useMemo, useState } from 'react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../../components/primitives/ZButton';
import { ZInput } from '../../../components/primitives/ZInput';
import { apiClient } from '../../../lib/apiClient';
import { bootstrapShiftContext } from '../../../lib/shiftDetection';
import { formatShiftDate } from '../../../lib/dateFormat';
import { useShiftStore } from '../../../store/shiftStore';
import type { AnnBoardRow } from '../../../components/process/bodies/AnnBaseCard';
import type { ProcessQueueCard } from '../../../store/processStore';
import {
  annBatchingAdvisories,
  type AnnBaseCapacity,
  type AnnSpecLimit,
} from '../../../lib/annBatchingAdvisories';

/** Charge builder — stack bottom→top (seq 1 = bottom). */
export function AnnMhBatchingPage() {
  const shiftLogId = useShiftStore((s) => s.shiftLogId);
  const [queue, setQueue] = useState<ProcessQueueCard[]>([]);
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [bases, setBases] = useState<AnnBaseCapacity[]>([]);
  const [limits, setLimits] = useState<AnnSpecLimit[]>([]);
  const [stack, setStack] = useState<string[]>([]);
  const [batchNo, setBatchNo] = useState('');
  const [chargeNo, setChargeNo] = useState('');
  const [baseNo, setBaseNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [incomingSearch, setIncomingSearch] = useState('');

  const ensureShift = useCallback(async () => {
    await bootstrapShiftContext('ANN');
    const { shiftDate, shiftCode, shiftLogId: existing } = useShiftStore.getState();
    if (existing) return existing;
    const qs = `?date=${encodeURIComponent(shiftDate)}&shift=${encodeURIComponent(shiftCode)}`;
    const data = await apiClient.get<{ shiftLogId: string; shiftDate: string; shiftCode: string }>(`/shift-logs/active/ANN${qs}`);
    useShiftStore.setState({
      shiftLogId: data.shiftLogId,
      shiftDate: formatShiftDate(data.shiftDate),
      shiftCode: data.shiftCode as 'A' | 'B' | 'C',
      processLine: 'ANN',
    });
    return data.shiftLogId;
  }, []);

  const reload = useCallback(async () => {
    const [q, b, basesRes, lims] = await Promise.all([
      apiClient.get<{ queue: ProcessQueueCard[] }>('/stations/ann/queue'),
      apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board'),
      apiClient.get<{ bases: AnnBaseCapacity[] }>('/stations/ann/bases'),
      apiClient.get<{ limits: AnnSpecLimit[] }>('/stations/ann/spec-limits'),
    ]);
    setQueue((q.queue ?? []).filter((c) => c.status === 'PENDING'));
    setBoard(b.board ?? []);
    setBases(basesRes.bases ?? []);
    setLimits(lims.limits ?? []);
  }, []);

  useEffect(() => {
    void ensureShift().catch(() => undefined);
    void reload();
  }, [ensureShift, reload]);

  const vacantBases = useMemo(
    () => board.filter((r) => !r.charge || r.charge.status === 'DONE').map((r) => r.base_no),
    [board],
  );

  const prepared = useMemo(
    () => board.filter((r) => r.charge && r.charge.status !== 'DONE'),
    [board],
  );

  const stackWeight = useMemo(
    () => stack.reduce((sum, coilNo) => {
      const c = queue.find((q) => q.coilNo === coilNo);
      return sum + Number(c?.weightMt ?? 0);
    }, 0),
    [queue, stack],
  );

  const advisories = useMemo(() => {
    const base = bases.find((b) => b.base_no === baseNo) ?? null;
    return annBatchingAdvisories({
      coilCount: stack.length,
      weightMt: stackWeight,
      base: baseNo ? base : null,
      limits,
    });
  }, [baseNo, bases, limits, stack.length, stackWeight]);

  function addToStack(coilNo: string) {
    setStack((s) => (s.includes(coilNo) ? s : [...s, coilNo]));
  }

  function removeFromStack(coilNo: string) {
    setStack((s) => s.filter((c) => c !== coilNo));
  }

  function moveInStack(coilNo: string, dir: -1 | 1) {
    setStack((s) => {
      const i = s.indexOf(coilNo);
      if (i < 0) return s;
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function createBatch() {
    setError(null);
    setOkMsg(null);
    if (stack.length === 0) {
      setError('Add at least one coil to the stack.');
      return;
    }
    setBusy(true);
    try {
      const logId = shiftLogId ?? (await ensureShift());
      if (!logId) throw new Error('No ANN shift log — start shift first.');
      const cn = chargeNo.trim() || `ANN-${Date.now().toString(36).toUpperCase()}`;
      const bn = batchNo.trim() || cn;
      const coils = stack.map((coilNo, i) => ({ coilNo, seqNo: i + 1 }));
      await apiClient.post('/stations/ann/charges', {
        action: 'create',
        chargeNo: cn,
        shiftLogId: logId,
        baseNo: baseNo || undefined,
        annealingBatchNo: bn,
        coils,
      });
      setStack([]);
      setChargeNo('');
      setBatchNo('');
      setBaseNo('');
      setOkMsg(`Created ${cn} · batch ${bn}`);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  const available = useMemo(() => {
    const free = queue.filter((c) => !stack.includes(c.coilNo));
    const q = incomingSearch.trim().toLowerCase();
    if (!q) return free;
    return free.filter((c) => {
      const coil = c.coilNo.toLowerCase();
      const batch = (c.batchNumber ?? '').toLowerCase();
      const grade = (c.gradeCode ?? '').toLowerCase();
      const customer = (c.customerName ?? '').toLowerCase();
      return coil.includes(q) || batch.includes(q) || grade.includes(q) || customer.includes(q);
    });
  }, [incomingSearch, queue, stack]);

  return (
    <MachineHeadShell
      title="Ann Batching"
      subtitle="Stack orders bottom→top, assign batch + base, create charge"
      fillViewport
      onRefresh={() => void reload()}
    >
      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[1fr_1fr_14rem]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
          <h2 className="shrink-0 border-b border-border px-3 py-2 text-sm font-bold">Incoming orders</h2>
          <div className="shrink-0 border-b border-border px-3 py-2">
            <input
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              placeholder="Search coil / batch / grade / customer"
              value={incomingSearch}
              onChange={(e) => setIncomingSearch(e.target.value)}
              aria-label="Search incoming orders"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-auto p-2 space-y-1">
            {available.length === 0 && <li className="text-sm text-muted-foreground px-2 py-4">No pending coils.</li>}
            {available.map((c) => (
              <li key={c.coilNo}>
                <button
                  type="button"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => addToStack(c.coilNo)}
                >
                  <span className="font-mono tabular-nums font-semibold">{c.coilNo}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {c.gradeCode ?? '—'} · {Number(c.weightMt ?? 0).toFixed(2)} MT
                    {c.customerName ? ` · ${c.customerName}` : ''}
                    {c.batchNumber ? ` · ${c.batchNumber}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
          <h2 className="shrink-0 border-b border-border px-3 py-2 text-sm font-bold">
            Stack <span className="font-normal text-muted-foreground">(1 = bottom)</span>
          </h2>
          <div className="flex min-h-0 flex-1 flex-col-reverse overflow-auto p-2 gap-1">
            {stack.length === 0 && (
              <p className="text-sm text-muted-foreground px-2 py-4 text-center">Tap coils to stack from the bottom up.</p>
            )}
            {stack.map((coilNo, i) => (
              <div
                key={coilNo}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 font-mono tabular-nums truncate">{coilNo}</span>
                <button type="button" className="text-xs underline text-muted-foreground" onClick={() => moveInStack(coilNo, 1)} aria-label="Move toward top">↑</button>
                <button type="button" className="text-xs underline text-muted-foreground" onClick={() => moveInStack(coilNo, -1)} aria-label="Move toward bottom">↓</button>
                <button type="button" className="text-xs underline text-destructive" onClick={() => removeFromStack(coilNo)}>Remove</button>
              </div>
            ))}
          </div>
          <div className="shrink-0 space-y-2 border-t border-border p-3">
            <div className="grid grid-cols-2 gap-2">
              <ZInput label="Annealing batch no" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} mono={false} className="!h-9 rounded-lg" />
              <ZInput label="Charge no (optional)" value={chargeNo} onChange={(e) => setChargeNo(e.target.value)} mono={false} className="!h-9 rounded-lg" placeholder="Auto" />
            </div>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Base
              <select
                className="h-9 min-h-9 rounded-lg border border-input bg-background px-3 text-sm"
                value={baseNo}
                onChange={(e) => setBaseNo(e.target.value)}
              >
                <option value="">Unassigned</option>
                {vacantBases.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                {board.filter((r) => r.charge && r.charge.status !== 'DONE').map((r) => (
                  <option key={`occ-${r.base_no}`} value={r.base_no} disabled>
                    {r.base_no} (occupied)
                  </option>
                ))}
              </select>
            </label>
            {advisories.length > 0 && (
              <ul className="rounded-lg border border-status-stopped/40 bg-status-stopped/10 px-3 py-2 space-y-1">
                {advisories.map((w) => (
                  <li key={w} className="text-xs text-status-stopped">{w}</li>
                ))}
                <li className="text-[10px] text-muted-foreground">Advisory only — create still allowed.</li>
              </ul>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {okMsg && <p className="text-sm text-status-running">{okMsg}</p>}
            <ZButton type="button" variant="primary" className="w-full min-h-10 h-10 rounded-lg" disabled={busy} onClick={() => void createBatch()}>
              Create batch
            </ZButton>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
          <h2 className="shrink-0 border-b border-border px-3 py-2 text-sm font-bold">On bases</h2>
          <ul className="min-h-0 flex-1 overflow-auto p-2 space-y-1 text-xs">
            {prepared.length === 0 && <li className="text-muted-foreground px-1 py-3">No active charges.</li>}
            {prepared.map((r) => (
              <li key={r.base_no} className="rounded-lg border border-border bg-card px-2 py-2">
                <p className="font-bold font-mono">{r.base_no}</p>
                <p className="text-muted-foreground">
                  {r.charge?.annealing_batch_no ?? r.charge?.charge_no}
                  {' · '}{r.charge?.current_stage_code ?? '—'}
                </p>
              </li>
            ))}
            <li className="pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Vacant</li>
            {vacantBases.map((b) => (
              <li key={b} className="rounded-lg border border-dashed border-border px-2 py-1.5 font-mono">{b}</li>
            ))}
          </ul>
        </aside>
      </div>
    </MachineHeadShell>
  );
}
