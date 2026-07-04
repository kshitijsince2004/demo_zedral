import React from 'react';

interface ChartTooltipPayload {
  name?: React.Key;
  color?: string;
  fill?: string;
  value?: React.ReactNode;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayload[];
  label?: React.ReactNode;
}

/**
 * ChartTooltip — shared Recharts tooltip component.
 *
 * Theme-aware (uses `bg-card text-card-foreground` instead of hardcoded
 * `bg-white`), so it renders correctly across all 5 Zedral themes.
 */
export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-4 py-3 text-xs">
      <div className="font-semibold text-foreground mb-2">{label}</div>
      {payload.map((p, index) => (
        <div key={p.name ?? index} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
