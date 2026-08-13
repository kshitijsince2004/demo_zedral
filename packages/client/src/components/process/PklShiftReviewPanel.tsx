import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import {
  Panel,
  PanelBody,
  PanelHeader,
  StatCell,
} from '../../pages/live/MachineHeadDashboardPanels';

type Review = {
  production?: {
    totalProdMt: number;
    coilsDone: number;
    avgLineSpeed: number;
    repeats: number;
    wpW?: number;
    wpP?: number;
    endFillYes?: number;
    chartReadings: number;
    chartDue: number;
    intervalHours?: number;
  };
  chart?: {
    readingsLogged: number;
    readingsDue: number;
    times?: string[];
    lineIncharge?: Array<{ chartTime: string; lineIncharge: string | null }>;
  };
  stoppages?: Array<{ category_code?: string; duration_min?: number; remarks?: string; start_at?: string }>;
  crew?: Array<{ operatorName?: string; roleCode?: string }>;
};

type QueueCard = { coilNo: string; gradeCode?: string; weightMt?: number; status?: string };

function ProductionStats({ p, chart }: { p: Review['production']; chart: Review['chart'] }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3">
      <StatCell label="Pickled MT" value={p ? p.totalProdMt.toFixed(2) : '—'} mono />
      <StatCell label="Coils" value={p?.coilsDone ?? '—'} />
      <StatCell label="Avg speed" value={p?.avgLineSpeed != null ? `${p.avgLineSpeed} m/min` : '—'} mono />
      <StatCell label="W / P" value={p ? `${p.wpW ?? 0} / ${p.wpP ?? 0}` : '—'} mono />
      <StatCell label="Repeats" value={p?.repeats ?? '—'} />
      <StatCell label="End fill" value={p?.endFillYes ?? '—'} />
      <StatCell label="Chart logged" value={chart?.readingsLogged ?? p?.chartReadings ?? '—'} />
      <StatCell label="Chart due" value={chart?.readingsDue ?? p?.chartDue ?? '—'} />
      {p?.intervalHours != null && (
        <StatCell label="Interval" value={`${p.intervalHours}h`} mono />
      )}
    </dl>
  );
}

/** PKL MH shift review — HRS-style hierarchy with PKL KPIs and process data. */
export function PklShiftReviewPanel({
  shiftLogId,
  variant = 'full',
}: {
  shiftLogId: string | null;
  /** compact: overview KPI strip (like HRS Shift Summary); full: all sections */
  variant?: 'compact' | 'full';
}) {
  const [data, setData] = useState<Review | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [nextCoils, setNextCoils] = useState<QueueCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shiftLogId) { setData(null); setNotes(null); setNextCoils([]); return; }
    void Promise.all([
      apiClient.get<Review>(`/stations/pkl/shift-review?shiftLogId=${encodeURIComponent(shiftLogId)}`),
      apiClient.get<{ notes?: string }>(`/shift-logs/${encodeURIComponent(shiftLogId)}/handover/summary`).catch(() => null),
      apiClient.get<{ queue: QueueCard[] }>('/pkl-order/queue').catch(() => ({ queue: [] as QueueCard[] })),
    ])
      .then(([review, h, q]) => {
        setData(review);
        setNotes(h?.notes ?? null);
        setNextCoils((q.queue ?? []).filter((c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS').slice(0, 5));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'));
  }, [shiftLogId]);

  if (!shiftLogId) {
    if (variant === 'compact') {
      return (
        <Panel>
          <PanelHeader title="Shift Review" />
          <PanelBody empty emptyLabel="Shift log not ready yet" />
        </Panel>
      );
    }
    return (
      <Panel>
        <PanelHeader title="Shift Review" />
        <PanelBody empty emptyLabel="Select a PKL shift log" />
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel>
        <PanelHeader title="Shift Review" />
        <PanelBody>
          <p className="px-4 py-6 text-sm text-destructive text-center">{error}</p>
        </PanelBody>
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel>
        <PanelHeader title="Shift Review" />
        <PanelBody>
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">Loading…</p>
        </PanelBody>
      </Panel>
    );
  }

  const p = data.production;
  const chart = data.chart;
  const stoppages = data.stoppages ?? [];
  const crew = data.crew ?? [];
  const lineIncharge = chart?.lineIncharge ?? [];

  if (variant === 'compact') {
    return (
      <Panel>
        <PanelHeader title="Shift Review" />
        <PanelBody>
          <ProductionStats p={p} chart={chart} />
        </PanelBody>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Production" />
        <PanelBody>
          <ProductionStats p={p} chart={chart} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Process chart" />
        <PanelBody empty={lineIncharge.length === 0 && !chart?.readingsLogged} emptyLabel="No chart readings this shift">
          <div className="px-4 py-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Readings logged: <span className="font-mono font-semibold text-foreground">{chart?.readingsLogged ?? p?.chartReadings ?? 0}</span>
              {' · '}
              Due: <span className="font-mono font-semibold text-foreground">{chart?.readingsDue ?? p?.chartDue ?? '—'}</span>
            </p>
            {lineIncharge.length > 0 && (
              <div className="overflow-auto rounded-lg border border-border">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-secondary/40">
                      <th className="px-4 py-2">Time</th>
                      <th className="px-4 py-2">Line incharge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineIncharge.map((row) => (
                      <tr key={row.chartTime} className="border-t border-border">
                        <td className="px-4 py-1.5">{row.chartTime}</td>
                        <td className="px-4 py-1.5">{row.lineIncharge ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Shift handover" />
        <PanelBody>
          <p className="px-4 py-3 text-sm whitespace-pre-wrap">
            {notes?.trim() ? notes : 'No handover notes yet'}
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Next orders" />
        <PanelBody empty={nextCoils.length === 0} emptyLabel="Queue empty">
          <ul className="px-4 py-3 space-y-1 text-sm">
            {nextCoils.map((c) => (
              <li key={c.coilNo} className="flex justify-between gap-2 font-mono">
                <span className="font-bold">{c.coilNo}</span>
                <span className="text-muted-foreground">{c.gradeCode} · {c.weightMt} MT · {c.status}</span>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Stoppages" />
        <PanelBody empty={stoppages.length === 0} emptyLabel="None">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Category</th>
                <th>Duration</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {stoppages.map((s, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2 font-mono">{s.category_code ?? '—'}</td>
                  <td className="font-mono">{s.duration_min != null ? `${s.duration_min} min` : '—'}</td>
                  <td className="text-muted-foreground">{s.remarks ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Crew" />
        <PanelBody empty={crew.length === 0} emptyLabel="None logged">
          <ul className="px-4 py-3 space-y-1 text-sm">
            {crew.map((c, i) => (
              <li key={i}>{c.operatorName} · {c.roleCode}</li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}
