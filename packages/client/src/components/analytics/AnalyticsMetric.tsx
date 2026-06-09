import type { Tone } from '../../lib/tones';
import { toneText } from '../../lib/tones';

interface AnalyticsMetricProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaTone?: Tone;
  sub?: string;
}

export function AnalyticsMetric({ label, value, delta, deltaTone, sub }: AnalyticsMetricProps) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 border border-border bg-background rounded-2xl min-w-[150px] flex-1 shadow-sm">
      <span className="z-rail-label">{label}</span>
      <span className="font-mono text-xl font-semibold tabular-nums text-foreground">{value}</span>
      {delta && (
        <span className={`text-[11px] font-medium ${deltaTone ? toneText[deltaTone] : 'text-muted-foreground'}`}>
          {delta}
        </span>
      )}
      {sub && !delta && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
