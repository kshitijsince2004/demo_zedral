import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';

type Metrics = {
  targetMt: number;
  totalProdMt: number;
  scrapMt: number;
  scrapPct: number;
  coilsDone: number;
  settingCount: number;
};

type QueueCard = { coilNo: string; gradeCode?: string; weightMt?: number; status?: string };

/** HRS MH shift review — slit metrics + handover notes + next orders. */
export function HrsShiftReviewPanel({ shiftLogId }: { shiftLogId: string | null }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [nextCoils, setNextCoils] = useState<QueueCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shiftLogId) {
      setMetrics(null);
      setNotes(null);
      setNextCoils([]);
      return;
    }
    void Promise.all([
      apiClient.get<Metrics>(`/stations/hrs/shift-metrics/${encodeURIComponent(shiftLogId)}`),
      apiClient.get<{ notes?: string }>(`/shift-logs/${encodeURIComponent(shiftLogId)}/handover/summary`).catch(() => null),
      apiClient.get<{ queue: QueueCard[] }>('/hrs-order/queue').catch(() => ({ queue: [] as QueueCard[] })),
    ])
      .then(([m, h, q]) => {
        setMetrics(m);
        setNotes(h?.notes ?? null);
        setNextCoils((q.queue ?? []).filter((c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS').slice(0, 5));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'));
  }, [shiftLogId]);

  if (!shiftLogId) return <p className="text-sm text-muted-foreground">Select an HRS shift log</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!metrics) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Production</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Metric label="Target MT" value={metrics.targetMt.toFixed(2)} />
          <Metric label="Production MT" value={metrics.totalProdMt.toFixed(2)} />
          <Metric label="Scrap MT" value={metrics.scrapMt.toFixed(2)} />
          <Metric label="Scrap %" value={`${metrics.scrapPct}%`} />
          <Metric label="Coils" value={metrics.coilsDone} />
          <Metric label="Settings" value={metrics.settingCount} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Shift handover</h3>
        <p className="text-sm whitespace-pre-wrap">{notes?.trim() ? notes : 'No handover notes yet'}</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Next orders</h3>
        {nextCoils.length === 0 ? (
          <p className="text-sm text-muted-foreground">Queue empty</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {nextCoils.map((c) => (
              <li key={c.coilNo} className="flex justify-between gap-2 font-mono">
                <span className="font-bold">{c.coilNo}</span>
                <span className="text-muted-foreground">{c.gradeCode} · {c.weightMt} MT · {c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="bg-secondary/40 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-semibold font-mono">{value ?? '—'}</p>
    </div>
  );
}
