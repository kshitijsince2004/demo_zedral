import React from 'react';
import { type Tone, toneText, toneBg, toneBorder } from '../../lib/tones';
import {
  AlertTriangle,
  Check,
  CircleAlert,
  CircleX,
  Info,
  Minus,
} from 'lucide-react';

const toneIcon: Record<Tone, React.ReactNode> = {
  success: <Check className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />,
  warning: <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />,
  info: <Info className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />,
  destructive: <CircleX className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />,
  purple: <CircleAlert className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />,
  muted: <Minus className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />,
  accent: <Check className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />,
};

interface ZBadgeProps {
  tone: Tone;
  label: string;
  dot?: boolean;
}

export function ZBadge({ tone, label, dot }: ZBadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 border px-2 py-0.5',
        'text-[10px] font-semibold uppercase tracking-[0.12em]',
        'rounded-sm',
        toneText[tone],
        toneBg[tone],
        toneBorder[tone],
      ].join(' ')}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot" />
      ) : (
        toneIcon[tone]
      )}
      {label}
    </span>
  );
}
