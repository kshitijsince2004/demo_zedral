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

type RwdQueueCard = {
  coilNo: string;
  batchNumber?: string;
  status: string;
  gradeCode?: string;
  weightMt?: number;
  machineCode?: string;
  tensionMpa?: number | null;
  finishWeightMt?: number | null;
  combinedGroupId?: string | null;
};

/** RWD outgoing handover — tension / group weight / machine inside shared shell. */
export function RwdOutgoingHandoverPage() {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const shiftLogId = useShiftStore((s) => s.shiftLogId);
  const queue = useProcessStore((s) => s.queue);
  const loadQueue = useProcessStore((s) => s.loadQueue);

  const [rwdQueue, setRwdQueue] = useState<RwdQueueCard[]>([]);
  const [twoHiQueue, setTwoHiQueue] = useState<RwdQueueCard[]>([]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  useEffect(() => {
    void Promise.all([
      apiClient.get<{ queue?: RwdQueueCard[] }>('/rewinding/queue?machine=RWD')
        .then((r) => setRwdQueue(r.queue ?? []))
        .catch(() => setRwdQueue([])),
      apiClient.get<{ queue?: RwdQueueCard[] }>('/rewinding/queue?machine=2HI')
        .then((r) => setTwoHiQueue(r.queue ?? []))
        .catch(() => setTwoHiQueue([])),
    ]);
  }, [shiftLogId]);

  const active = useMemo(() => {
    const all = [...rwdQueue, ...twoHiQueue];
    return all.filter((c) => c.status === 'IN_PROGRESS' || c.status === 'STOPPAGE' || c.status === 'PREPARING');
  }, [rwdQueue, twoHiQueue]);

  const completed = useMemo(() => {
    const all = [...rwdQueue, ...twoHiQueue];
    return all.filter((c) => c.status === 'COMPLETED').slice(0, 8);
  }, [rwdQueue, twoHiQueue]);

  const groupWeight = useMemo(() => {
    const groups = new Map<string, number>();
    for (const c of [...active, ...completed]) {
      const gid = c.combinedGroupId;
      if (!gid) continue;
      groups.set(gid, (groups.get(gid) ?? 0) + Number(c.finishWeightMt ?? c.weightMt ?? 0));
    }
    const sum = [...groups.values()].reduce((a, b) => a + b, 0);
    return groups.size ? sum : null;
  }, [active, completed]);

  const machinesOnShift = useMemo(() => {
    const codes = new Set(
      [...active, ...completed].map((c) => c.machineCode).filter(Boolean) as string[],
    );
    if (codes.size === 0) {
      if (rwdQueue.length) codes.add('RWD');
      if (twoHiQueue.length) codes.add('2HI');
    }
    return [...codes].join(' · ') || 'RWD | 2HI';
  }, [active, completed, rwdQueue.length, twoHiQueue.length]);

  const avgTension = useMemo(() => {
    const vals = [...active, ...completed]
      .map((c) => c.tensionMpa)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [active, completed]);

  const nextCoils = useMemo(
    () => queue.filter((c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS').slice(0, 5),
    [queue],
  );

  const doneMt = useMemo(
    () => completed.reduce((s, c) => s + Number(c.finishWeightMt ?? c.weightMt ?? 0), 0),
    [completed],
  );

  return (
    <ProcessOutgoingHandoverShell machineCode="RWD" title="Rewinding" loadingLabel="Loading RWD handover…">
      <section className="rounded-lg border border-border bg-card p-5">
        <HandoverSectionHeader icon={<Clock className="h-4 w-4" />} title="Production Summary" locked />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <HandoverLockedField label="Machine" value={machinesOnShift} />
          <HandoverLockedField label="Active Orders" value={active.length} />
          <HandoverLockedField label="Completed" value={completed.length} />
          <HandoverLockedField label="Done MT" value={doneMt ? doneMt.toFixed(2) : '—'} />
          <HandoverLockedField
            label="Avg Tension MPa"
            value={avgTension != null ? avgTension.toFixed(1) : '—'}
          />
          <HandoverLockedField
            label="Combined Group Σ MT"
            value={groupWeight != null ? groupWeight.toFixed(2) : '—'}
          />
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
