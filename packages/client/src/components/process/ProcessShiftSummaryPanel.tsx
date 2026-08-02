export type ProcessShiftMetricItem = {
  label: string;
  value: string;
};

/** Shared shift-summary panel — HRS/PKL/CRS feed their own metric set. */
export function ProcessShiftSummaryPanel({
  items,
  loading,
  compact,
  footnote,
}: {
  items: ProcessShiftMetricItem[];
  loading?: boolean;
  compact?: boolean;
  footnote?: string;
}) {
  return (
    <div className={`bg-card text-card-foreground border border-border rounded-xl shadow flex flex-col ${compact ? 'p-3' : 'p-4'}`}>
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
        Shift Summary
      </h2>
      {loading && <p className="text-sm text-muted-foreground">Calculating…</p>}
      {!loading && (
        <div className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>
          {items.map((item) => (
            <div key={item.label} className="bg-secondary rounded-xl px-3 py-3 min-h-[64px]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{item.label}</p>
              <p className="font-mono text-xl font-bold text-foreground mt-1">{item.value}</p>
            </div>
          ))}
        </div>
      )}
      {footnote ? <p className="text-[10px] text-muted-foreground mt-3">{footnote}</p> : null}
    </div>
  );
}
