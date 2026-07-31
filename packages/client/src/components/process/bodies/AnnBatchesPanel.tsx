import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../../hooks/useProcessWorkspaceBase';

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
        <h2 className="text-sm font-bold">Preparing / unassigned batches</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...preparing, ...otherActive].length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-6">No active ANN batches.</p>
          )}
          {[...preparing, ...otherActive].map((c) => (
            <button
              key={c.charge_no}
              type="button"
              className="text-left border rounded-xl p-4 hover:border-primary/40 hover:bg-secondary/20"
              onClick={() => navigate(`${basePath}/charge/${encodeURIComponent(c.charge_no)}`)}
            >
              <div className="flex justify-between gap-2">
                <span className="font-bold font-mono">{c.annealing_batch_no ?? c.charge_no}</span>
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-secondary">{c.status}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Base {c.base_no ?? 'unassigned'} · {c.current_stage_code ?? '—'}
              </p>
              <p className="text-xs mt-1">
                {c.grade_code ?? '—'} · {c.no_of_coils ?? 0} coils · {Number(c.charge_wt_mt ?? 0).toFixed(2)} MT
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Pending queue (awaiting batch)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {queue.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-6">No pending coils.</p>
          )}
          {queue.map((c) => (
            <div key={c.coilNo} className="border rounded-xl p-4 bg-card">
              <span className="font-bold font-mono">{c.coilNo}</span>
              <p className="text-sm text-muted-foreground mt-1">{c.customerName}</p>
              <p className="text-xs mt-1">
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
