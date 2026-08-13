import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ZBadge } from '../../primitives/ZBadge';
import { ZButton } from '../../primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../../hooks/useProcessWorkspaceBase';
import type { Tone } from '../../../lib/tones';
import { AnnBaseAssignModal } from './AnnBaseAssignModal';

type ChargeRow = {
  charge_no: string;
  annealing_batch_no: string | null;
  base_no: string | null;
  status: string;
  current_stage_code: string | null;
  no_of_coils: number | null;
  charge_wt_mt: number | string | null;
  grade_code: string | null;
};

type QueueCard = {
  coilNo: string;
  gradeCode: string;
  customerName: string;
  weightMt: number;
  status: string;
  batchNumber?: string;
};

function chargeTone(status: string): Tone {
  const s = status.toUpperCase();
  if (s === 'PREPARING') return 'info';
  if (s === 'PENDING' || s === 'HOLD') return 'accent';
  if (s === 'DONE' || s === 'COMPLETE') return 'info';
  if (s === 'REJECT' || s === 'REJECTED') return 'destructive';
  if (s.includes('LOAD') || s.includes('PREP') || s === 'ACTIVE') return 'info';
  return 'success';
}

function displayStatus(c: ChargeRow) {
  if (!c.base_no || c.status === 'PREPARING') return 'PREPARING';
  return c.status;
}

/** ANN Batches tab — preparing/unassigned charges + pending queue. */
export function AnnBatchesPanel() {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [queue, setQueue] = useState<QueueCard[]>([]);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [c, q] = await Promise.all([
      apiClient.get<{ charges: ChargeRow[] }>('/stations/ann/charges'),
      apiClient.get<{ queue: QueueCard[] }>('/stations/ann/queue'),
    ]);
    setCharges((c.charges ?? []).filter((x) => x.status !== 'DONE'));
    setQueue((q.queue ?? []).filter((x) =>
      x.status === 'PENDING' || x.status === 'PREPARING' || x.status === 'IN_PROGRESS',
    ));
  }, []);

  useEffect(() => { void reload().catch(() => undefined); }, [reload]);

  const preparing = charges.filter((c) => !c.base_no || c.status === 'PREPARING');
  const otherActive = charges.filter((c) => !preparing.includes(c));

  async function startCharge(chargeNo: string) {
    setError(null);
    try {
      await apiClient.post(`/stations/ann/charges/${encodeURIComponent(chargeNo)}/start`);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Start failed');
    }
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-6">
      <section className="space-y-2">
        <div className="rounded-lg bg-info/10 border border-info/20 px-3 py-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-info">Preparing / unassigned batches</h2>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...preparing, ...otherActive].length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-6">No active ANN batches.</p>
          )}
          {[...preparing, ...otherActive].map((c) => {
            const status = displayStatus(c);
            const needsBase = !c.base_no;
            const canStart = Boolean(c.base_no) && (c.status === 'PREPARING' || status === 'PREPARING');
            return (
              <div key={c.charge_no} className="rounded-lg border border-border bg-background p-4 shadow-sm space-y-2">
                <button
                  type="button"
                  className="w-full text-left min-h-[3.5rem] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  onClick={() => navigate(`${basePath}/charge/${encodeURIComponent(c.charge_no)}`)}
                >
                  <div className="flex justify-between gap-2 items-start">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Ann batch no.</p>
                      <span className="font-bold font-mono tabular-nums text-foreground">
                        {c.annealing_batch_no?.trim() ? c.annealing_batch_no : '—'}
                      </span>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Charge {c.charge_no}</p>
                    </div>
                    <ZBadge tone={chargeTone(status)} label={status} />
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mt-2">
                    Base {c.base_no ?? 'unassigned'} · {c.current_stage_code ?? '—'}
                  </p>
                  <p className="text-xs font-mono tabular-nums mt-1 text-foreground">
                    {c.grade_code ?? '—'} · {c.no_of_coils ?? 0} coils · {Number(c.charge_wt_mt ?? 0).toFixed(2)} MT
                  </p>
                </button>
                {needsBase && (
                  <ZButton type="button" variant="primary" size="sm" className="w-full" onClick={() => setAssignFor(c.charge_no)}>
                    Assign Base
                  </ZButton>
                )}
                {canStart && !needsBase && (
                  <ZButton type="button" variant="primary" size="sm" className="w-full" onClick={() => void startCharge(c.charge_no)}>
                    Start / In Progress
                  </ZButton>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="rounded-lg bg-accent/15 border border-accent/30 px-3 py-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-accent-foreground">Pending queue (awaiting batch)</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {queue.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-6">No pending coils.</p>
          )}
          {queue.map((c) => (
            <div key={c.coilNo} className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex justify-between gap-2 items-start">
                <span className="font-bold font-mono tabular-nums text-foreground">{c.coilNo}</span>
                <ZBadge tone="accent" label="PENDING" />
              </div>
              <p className="text-sm text-muted-foreground mt-2">{c.customerName}</p>
              <p className="text-xs font-mono tabular-nums mt-1 text-foreground">
                {c.gradeCode} · {Number(c.weightMt ?? 0).toFixed(2)} MT
                {c.batchNumber ? ` · ${c.batchNumber}` : ''}
              </p>
            </div>
          ))}
        </div>
      </section>

      <AnnBaseAssignModal
        open={!!assignFor}
        chargeNo={assignFor ?? ''}
        title="Assign base"
        confirmLabel="Assign Base"
        onClose={() => setAssignFor(null)}
        onAssigned={async (baseNo) => {
          if (!assignFor) return;
          await apiClient.post(`/stations/ann/charges/${encodeURIComponent(assignFor)}/assign-base`, { baseNo });
          await reload();
        }}
      />
    </div>
  );
}
