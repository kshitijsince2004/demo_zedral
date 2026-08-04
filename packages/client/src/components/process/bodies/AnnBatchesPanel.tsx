import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ZBadge } from '../../primitives/ZBadge';
import { apiClient } from '../../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../../hooks/useProcessWorkspaceBase';
import type { Tone } from '../../../lib/tones';

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
  if (s === 'PENDING' || s === 'HOLD') return 'accent';
  if (s === 'DONE' || s === 'COMPLETE') return 'info';
  if (s === 'REJECT' || s === 'REJECTED') return 'destructive';
  if (s.includes('LOAD') || s.includes('PREP') || s === 'ACTIVE') return 'info';
  return 'success';
}

/** ANN Batches tab — preparing/unassigned charges + pending queue. */
export function AnnBatchesPanel() {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [queue, setQueue] = useState<QueueCard[]>([]);

  useEffect(() => {
    void Promise.all([
      apiClient.get<{ charges: ChargeRow[] }>('/stations/ann/charges'),
      apiClient.get<{ queue: QueueCard[] }>('/stations/ann/queue'),
    ]).then(([c, q]) => {
      setCharges((c.charges ?? []).filter((x) => x.status !== 'DONE'));
      setQueue((q.queue ?? []).filter((x) => x.status === 'PENDING'));
    }).catch(() => undefined);
  }, []);

  const preparing = charges.filter((c) => !c.base_no || ['LOADING', 'PURGING', 'HEATING'].includes(c.current_stage_code ?? ''));
  const otherActive = charges.filter((c) => !preparing.includes(c));

  return (
    <div className="flex-1 overflow-auto p-4 space-y-6">
      <section className="space-y-2">
        <div className="rounded-lg bg-info/10 border border-info/20 px-3 py-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-info">Preparing / unassigned batches</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...preparing, ...otherActive].length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-6">No active ANN batches.</p>
          )}
          {[...preparing, ...otherActive].map((c) => (
            <button
              key={c.charge_no}
              type="button"
              className="text-left rounded-lg border border-border bg-background p-4 shadow-sm hover:border-primary/40 hover:bg-card min-h-[5.5rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => navigate(`${basePath}/charge/${encodeURIComponent(c.charge_no)}`)}
            >
              <div className="flex justify-between gap-2 items-start">
                <span className="font-bold font-mono tabular-nums text-foreground">{c.annealing_batch_no ?? c.charge_no}</span>
                <ZBadge tone={chargeTone(c.status)} label={c.status} />
              </div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mt-2">
                Base {c.base_no ?? 'unassigned'} · {c.current_stage_code ?? '—'}
              </p>
              <p className="text-xs font-mono tabular-nums mt-1 text-foreground">
                {c.grade_code ?? '—'} · {c.no_of_coils ?? 0} coils · {Number(c.charge_wt_mt ?? 0).toFixed(2)} MT
              </p>
            </button>
          ))}
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
    </div>
  );
}
