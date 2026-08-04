import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, FlaskConical, Lock } from 'lucide-react';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import {
  HandoverLockedField,
  HandoverSectionHeader,
  ProcessOutgoingHandoverShell,
} from '../../components/process/ProcessOutgoingHandoverShell';
import { ZButton } from '../../components/primitives/ZButton';
import { apiClient } from '../../lib/apiClient';
import { useShiftStore } from '../../store/shiftStore';
import { useProcessStore } from '../../store/processStore';

/** PKL outgoing handover — metrics / chart / stoppages / next coils inside shared shell. */
export function PklOutgoingHandoverPage() {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const shiftLogId = useShiftStore((s) => s.shiftLogId);
  const queue = useProcessStore((s) => s.queue);
  const loadQueue = useProcessStore((s) => s.loadQueue);

  const [metrics, setMetrics] = useState<{
    totalProdMt: number; coilsDone: number; avgLineSpeed: number; repeats: number;
    wpW?: number; wpP?: number; chartReadings: number; chartDue: number;
  } | null>(null);
  const [stoppages, setStoppages] = useState<Array<{
    category_code?: string; start_at?: string; duration_min?: number; remarks?: string;
  }>>([]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  useEffect(() => {
    if (!shiftLogId) return;
    void apiClient.get<typeof metrics>(`/stations/pkl/shift-metrics/${encodeURIComponent(shiftLogId)}`)
      .then(setMetrics)
      .catch(() => setMetrics(null));
    void apiClient.get<{ stoppages?: typeof stoppages }>(
      `/stations/pkl/shift-review?shiftLogId=${encodeURIComponent(shiftLogId)}`,
    )
      .then((r) => setStoppages(r.stoppages ?? []))
      .catch(() => setStoppages([]));
  }, [shiftLogId]);

  const nextCoils = useMemo(
    () => queue.filter((c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS').slice(0, 5),
    [queue],
  );

  return (
    <ProcessOutgoingHandoverShell machineCode="PKL" title="Pickling" loadingLabel="Loading PKL handover…">
      <section className="rounded-lg border border-border bg-card p-5">
        <HandoverSectionHeader icon={<Clock className="h-4 w-4" />} title="Production Summary" locked />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <HandoverLockedField label="Pickled MT" value={metrics ? metrics.totalProdMt.toFixed(2) : '—'} />
          <HandoverLockedField label="Coils" value={metrics?.coilsDone} />
          <HandoverLockedField label="Avg Speed M/min" value={metrics?.avgLineSpeed} />
          <HandoverLockedField label="W / P" value={metrics ? `${metrics.wpW ?? 0} / ${metrics.wpP ?? 0}` : '—'} />
          <HandoverLockedField label="Repeats" value={metrics?.repeats} />
          <HandoverLockedField label="Stoppages" value={stoppages.length} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <HandoverSectionHeader icon={<FlaskConical className="h-4 w-4" />} title="Process Chart Readings" locked />
        <div className="grid grid-cols-2 gap-3 mb-3">
          <HandoverLockedField label="Logged" value={metrics?.chartReadings} />
          <HandoverLockedField label="Due" value={metrics?.chartDue} />
        </div>
        <ZButton type="button" variant="secondary" onClick={() => navigate(`${basePath}/chart`)}>
          Open Process Chart
        </ZButton>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <HandoverSectionHeader icon={<Lock className="h-4 w-4" />} title="Stoppages" locked />
        {stoppages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stoppages this shift</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {stoppages.map((s, i) => (
              <li key={i} className="flex justify-between gap-2 border-b border-border/50 pb-2 font-mono text-xs">
                <span>{s.category_code ?? '—'} · {s.remarks ?? ''}</span>
                <span>{s.duration_min ?? '—'} min</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <HandoverSectionHeader icon={<Clock className="h-4 w-4" />} title="Next Orders" locked />
        {nextCoils.length === 0 ? (
          <p className="text-sm text-muted-foreground">Queue empty</p>
        ) : (
          <ul className="space-y-2">
            {nextCoils.map((c) => (
              <li key={c.coilNo} className="text-sm flex justify-between gap-2">
                <span className="font-mono font-bold">{c.coilNo}</span>
                <span className="text-muted-foreground">{c.gradeCode} · {c.weightMt} MT · {c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ProcessOutgoingHandoverShell>
  );
}
