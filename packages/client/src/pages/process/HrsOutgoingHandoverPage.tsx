import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
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

/** HRS outgoing handover — slit metrics + next orders inside shared shell. */
export function HrsOutgoingHandoverPage() {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const shiftLogId = useShiftStore((s) => s.shiftLogId);
  const queue = useProcessStore((s) => s.queue);
  const loadQueue = useProcessStore((s) => s.loadQueue);

  const [metrics, setMetrics] = useState<{
    targetMt: number; totalProdMt: number; scrapMt: number; scrapPct: number;
    coilsDone: number; settingCount: number;
  } | null>(null);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  useEffect(() => {
    if (!shiftLogId) return;
    void apiClient.get<typeof metrics>(`/stations/hrs/shift-metrics/${encodeURIComponent(shiftLogId)}`)
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, [shiftLogId]);

  const nextCoils = useMemo(
    () => queue.filter((c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS').slice(0, 5),
    [queue],
  );

  return (
    <ProcessOutgoingHandoverShell machineCode="HRS" title="HRS Slitting" loadingLabel="Loading HRS handover…">
      <section className="rounded-lg border border-border bg-card p-5">
        <HandoverSectionHeader icon={<Clock className="h-4 w-4" />} title="Production Summary" locked />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <HandoverLockedField label="Target MT" value={metrics ? metrics.targetMt.toFixed(2) : '—'} />
          <HandoverLockedField label="Production MT" value={metrics ? metrics.totalProdMt.toFixed(2) : '—'} />
          <HandoverLockedField label="Scrap MT" value={metrics ? metrics.scrapMt.toFixed(2) : '—'} />
          <HandoverLockedField label="Scrap %" value={metrics ? `${metrics.scrapPct}%` : '—'} />
          <HandoverLockedField label="Coils" value={metrics?.coilsDone} />
          <HandoverLockedField label="Settings" value={metrics?.settingCount} />
        </div>
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
        {basePath && (
          <ZButton type="button" variant="secondary" className="mt-3" onClick={() => navigate(basePath)}>
            Open Orders
          </ZButton>
        )}
      </section>
    </ProcessOutgoingHandoverShell>
  );
}
