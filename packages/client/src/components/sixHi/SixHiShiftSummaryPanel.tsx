import type { SixHiShiftSummary } from '@m1/shared-validation';

interface SixHiShiftSummaryPanelProps {
  summary: SixHiShiftSummary | null;
  loading?: boolean;
  compact?: boolean;
  /** Saved weight on the active order (shown immediately if API not yet synced). */
  liveOrderProducedMt?: number;
}

export function SixHiShiftSummaryPanel({ summary, loading, compact, liveOrderProducedMt }: SixHiShiftSummaryPanelProps) {
  const completedMt = summary?.completedProdMt ?? 0;
  const apiInProgress = summary?.inProgressProdMt ?? 0;
  const liveWt = liveOrderProducedMt ?? 0;
  const inProgressMt = Math.max(apiInProgress, liveWt);
  const totalProdMt = completedMt + inProgressMt;
  const extraLive = Math.max(0, liveWt - apiInProgress);

  const hasData = !!summary || liveWt > 0;

  const items = [
    { label: 'Total Production', value: hasData ? `${totalProdMt.toFixed(2)} MT` : '—' },
    { label: 'Total Rolling', value: hasData ? `${((summary?.totalRollingMt ?? 0) + extraLive).toFixed(2)} MT` : '—' },
    { label: 'Total Re-Rolling', value: summary ? `${summary.totalRerollMt.toFixed(2)} MT` : '—' },
    { label: 'Skin Pass', value: summary ? `${summary.totalSkinpassMt.toFixed(2)} MT` : '—' },
  ];

  return (
    <div className={`bg-card text-card-foreground border border-border rounded-xl shadow flex flex-col ${compact ? 'p-3' : 'p-4'}`}>
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
        Shift Summary
      </h2>
      {loading && <p className="text-sm text-muted-foreground">Calculating…</p>}
      {!loading && (
        <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {items.map((item) => (
            <div key={item.label} className="bg-secondary rounded-xl px-3 py-3 min-h-[64px]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{item.label}</p>
              <p className="font-mono text-xl font-bold text-foreground mt-1">{item.value}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-3">
        {inProgressMt > 0
          ? `${completedMt.toFixed(2)} MT completed · ${inProgressMt.toFixed(2)} MT in progress (saved)`
          : 'Totals from saved production data on this shift'}
      </p>
    </div>
  );
}
