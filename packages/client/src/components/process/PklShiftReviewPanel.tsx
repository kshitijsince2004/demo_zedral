import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';

type Review = {
  production?: {
    totalProdMt: number;
    coilsDone: number;
    avgLineSpeed: number;
    repeats: number;
    wpW?: number;
    wpP?: number;
    chartReadings: number;
    chartDue: number;
  };
  chart?: { readingsLogged: number; readingsDue: number; lineIncharge?: Array<{ chartTime: string; lineIncharge: string | null }> };
  stoppages?: Array<{ category_code?: string; duration_min?: number; remarks?: string; start_at?: string }>;
  crew?: Array<{ operatorName?: string; roleCode?: string }>;
};

/** Compact PKL shift-review stack for MH (revamp MH-3). */
export function PklShiftReviewPanel({ shiftLogId }: { shiftLogId: string | null }) {
  const [data, setData] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shiftLogId) { setData(null); return; }
    void apiClient.get<Review>(`/stations/pkl/shift-review?shiftLogId=${encodeURIComponent(shiftLogId)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'));
  }, [shiftLogId]);

  if (!shiftLogId) return <p className="text-sm text-muted-foreground">Select a PKL shift log</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const p = data.production;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Production</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Metric label="Pickled MT" value={p ? p.totalProdMt.toFixed(2) : '—'} />
          <Metric label="Coils" value={p?.coilsDone} />
          <Metric label="Avg speed" value={p?.avgLineSpeed} />
          <Metric label="W / P" value={p ? `${p.wpW ?? 0} / ${p.wpP ?? 0}` : '—'} />
          <Metric label="Chart logged" value={data.chart?.readingsLogged ?? p?.chartReadings} />
          <Metric label="Chart due" value={data.chart?.readingsDue ?? p?.chartDue} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Stoppages</h3>
        {(data.stoppages ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-1 text-xs font-mono">
            {(data.stoppages ?? []).map((s, i) => (
              <li key={i}>{s.category_code} · {s.duration_min ?? '—'} min · {s.remarks ?? ''}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Crew</h3>
        {(data.crew ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">None logged</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {(data.crew ?? []).map((c, i) => (
              <li key={i}>{c.operatorName} · {c.roleCode}</li>
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
