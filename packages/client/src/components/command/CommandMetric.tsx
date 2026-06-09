import type { Tone } from '../../lib/tones';
import { toneText } from '../../lib/tones';

interface CommandMetricProps {
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
  onClick?: () => void;
}

export function CommandMetric({ label, value, sub, tone, onClick }: CommandMetricProps) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={[
        'flex flex-col gap-1 px-4 py-3 border border-border bg-background text-left min-w-[140px]',
        'rounded-2xl shadow-sm transition-colors',
        onClick ? 'hover:border-accent/40 hover:bg-accent/5 cursor-pointer' : '',
      ].join(' ')}
    >
      <span className="z-rail-label">{label}</span>
      <span className={`font-mono text-xl font-semibold tabular-nums ${tone ? toneText[tone] : 'text-foreground'}`}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </Wrapper>
  );
}
