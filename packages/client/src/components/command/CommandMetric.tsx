import type { Tone } from '../../lib/tones';
import { toneText, toneRail } from '../../lib/tones';

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
        'z-card z-card-hover group flex flex-col gap-1.5 px-4 py-3.5 text-left min-w-[140px]',
        onClick ? 'cursor-pointer' : '',
      ].join(' ')}
    >
      <span className="flex items-center gap-1.5 z-eyebrow">
        <span className={`h-1.5 w-1.5 rounded-full ${tone ? toneRail[tone] : 'bg-primary/40'}`} aria-hidden />
        {label}
      </span>
      <span className={`font-mono text-2xl font-bold tabular-nums leading-none ${tone ? toneText[tone] : 'text-foreground'}`}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </Wrapper>
  );
}
