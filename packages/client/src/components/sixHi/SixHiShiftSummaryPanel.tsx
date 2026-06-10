import type { SixHiShiftSummary } from '@m1/shared-validation';

interface SixHiShiftSummaryPanelProps {
  summary: SixHiShiftSummary | null;
  loading?: boolean;
  compact?: boolean;
}

export function SixHiShiftSummaryPanel({ summary, loading, compact }: SixHiShiftSummaryPanelProps) {
  const items = [
    { label: 'Total Production', value: summary ? `${summary.totalProdMt.toFixed(2)} MT` : '—' },
    { label: 'Total Rolling', value: summary ? `${summary.totalRollingMt.toFixed(2)} MT` : '—' },
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
      <p className="text-[10px] text-muted-foreground mt-3">Auto-calculated from completed orders</p>
    </div>
  );
}
