import type { SixHiOrderDetail } from '@m1/shared-validation';

function formatToleranceNegative(value: number): string {
  const n = Math.abs(value);
  return `-${n} mm`;
}

export function ThicknessSpecs({
  order,
  compact,
}: {
  order: Pick<SixHiOrderDetail, 'inputThkMm' | 'targetThkMm' | 'minThkTolMm' | 'maxThkTolMm' | 'raMinUm' | 'raMaxUm'>;
  compact?: boolean;
}) {
  const pos = order.maxThkTolMm;
  const neg = order.minThkTolMm;
  const raMin = order.raMinUm;
  const raMax = order.raMaxUm;
  const hasThicknessVariance = pos != null || neg != null;
  const hasRa = raMin != null || raMax != null;
  const textSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div className={`flex flex-col sm:flex-row items-stretch gap-4 ${textSize}`}>
      <div className="flex-1 flex flex-col justify-center space-y-1.5 min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-muted-foreground text-left">Pre-Stage Thickness</span>
          <span className="font-mono font-bold text-foreground text-right">{order.inputThkMm} mm</span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-muted-foreground text-left">Target Thickness</span>
          <span className="font-mono font-bold text-foreground text-right">{order.targetThkMm} mm</span>
        </div>
      </div>

      {hasThicknessVariance && (
        <div className="flex-1 min-w-0">
          <div className="h-full rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 flex flex-col justify-center space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-left">Thickness Variance</p>
            {pos != null && (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-muted-foreground text-left">Thick Tolerance Positive: </span>
                <span className="font-mono font-semibold text-right">+{pos} mm</span>
              </div>
            )}
            {neg != null && (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-muted-foreground text-left">Thick Tolerance Negative: </span>
                <span className="font-mono font-semibold text-right">{formatToleranceNegative(neg)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {hasRa && (
        <div className="flex-1 min-w-0">
          <div className="h-full rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 flex flex-col justify-center space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-left">RA Variance</p>
            {raMin != null && (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-muted-foreground text-left">SP RA min: </span>
                <span className="font-mono font-semibold text-right">{raMin} mm</span>
              </div>
            )}
            {raMax != null && (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-muted-foreground text-left">SP RA max: </span>
                <span className="font-mono font-semibold text-right">{raMax} mm</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
