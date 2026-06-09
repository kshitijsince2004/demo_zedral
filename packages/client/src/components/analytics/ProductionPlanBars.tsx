import type { ProductionVsPlanEntry } from '../../lib/reportingService';

interface ProductionPlanBarsProps {
  lines: ProductionVsPlanEntry[];
}

export function ProductionPlanBars({ lines }: ProductionPlanBarsProps) {
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No production data</p>;
  }

  const maxVal = Math.max(...lines.flatMap((l) => [l.planned, l.actual]), 1);

  return (
    <div className="flex flex-col gap-3">
      {lines.map((line) => {
        const pct = line.planned > 0 ? Math.round((line.actual / line.planned) * 100) : 0;
        const paceTone = pct >= 95 ? 'text-success' : pct >= 80 ? 'text-warning' : 'text-destructive';
        return (
          <div key={line.lineId} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono font-semibold text-accent">{line.lineId}</span>
              <span className={`font-mono tabular-nums ${paceTone}`}>
                {line.actual.toFixed(1)} / {line.planned.toFixed(1)} MT · {pct}%
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-sm overflow-hidden flex">
              <div
                className="h-full bg-muted-foreground/30"
                style={{ width: `${(line.planned / maxVal) * 100}%` }}
                title={`Plan ${line.planned} MT`}
              />
            </div>
            <div className="h-2 -mt-2 bg-transparent rounded-sm overflow-hidden flex">
              <div
                className={`h-full ${pct >= 95 ? 'bg-success' : pct >= 80 ? 'bg-warning' : 'bg-destructive'}`}
                style={{ width: `${(line.actual / maxVal) * 100}%` }}
                title={`Actual ${line.actual} MT`}
              />
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground mt-1">Gray = plan</p>
    </div>
  );
}
