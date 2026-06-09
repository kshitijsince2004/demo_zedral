import React from 'react';
import { type Tone, toneText, toneRail } from '../../lib/tones';

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  tone: Tone;
  /** When provided, the card becomes clickable and triggers drill-down navigation. */
  onDrillDown?: () => void;
  /** Metric key passed to the drill-down handler (used for aria-label). */
  metric?: string;
}

export function KpiCard({ label, value, sub, tone, onDrillDown, metric }: KpiCardProps) {
  const isClickable = typeof onDrillDown === 'function';

  const inner = (
    <>
      <div className={`absolute inset-y-0 left-0 w-1 ${toneRail[tone]}`} />
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`mt-1 text-3xl font-bold tracking-tight ${toneText[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      {isClickable && (
        <div className="mt-2 text-[10px] text-muted-foreground/60 flex items-center gap-1">
          <span>↗</span>
          <span>Drill down</span>
        </div>
      )}
    </>
  );

  if (isClickable) {
    return (
      <button
        type="button"
        onClick={onDrillDown}
        aria-label={`Drill down into ${metric ?? label}`}
        className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm text-left w-full hover:border-primary/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm">
      {inner}
    </div>
  );
}
