import { useEffect, useState } from 'react';
import type { SixHiOrderStoppage } from '@m1/shared-validation';
import { resolveStoppageDisplayCode } from './SixHiStoppageCodes';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function elapsedMin(startAt: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(startAt).getTime()) / 60000));
}

interface OrderStoppageTableProps {
  stoppages: SixHiOrderStoppage[];
  onLogStoppage?: () => void;
  onEndStoppage?: () => void;
  hasActiveStoppage?: boolean;
}

export function OrderStoppageTable({
  stoppages,
  onLogStoppage,
  onEndStoppage,
  hasActiveStoppage,
}: OrderStoppageTableProps) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!stoppages.some((s) => !s.endAt)) return;
    const id = setInterval(() => tick((n) => n + 1), 10000);
    return () => clearInterval(id);
  }, [stoppages]);

  const totalMin = stoppages.reduce((sum, s) => {
    if (s.durationMin != null) return sum + s.durationMin;
    if (!s.endAt) return sum + elapsedMin(s.startAt);
    return sum;
  }, 0);

  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-foreground">Order Stoppages</h3>
        <div className="flex gap-2">
          {hasActiveStoppage && onEndStoppage && (
            <button
              type="button"
              onClick={onEndStoppage}
              className="min-h-11 px-4 rounded-xl bg-primary text-white text-xs font-bold"
            >
              End Stoppage
            </button>
          )}
          {onLogStoppage && !hasActiveStoppage && (
            <button
              type="button"
              onClick={onLogStoppage}
              className="min-h-11 px-4 rounded-xl border border-destructive text-destructive text-xs font-bold"
            >
              Log Stoppage
            </button>
          )}
        </div>
      </div>

      {stoppages.length === 0 ? (
        <p className="text-sm text-muted-foreground px-4 py-6">No stoppages recorded for this order.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="text-left px-4 py-2 font-bold">Code</th>
                <th className="text-left px-4 py-2 font-bold">Reason</th>
                <th className="text-left px-4 py-2 font-bold">Start</th>
                <th className="text-left px-4 py-2 font-bold">End</th>
                <th className="text-right px-4 py-2 font-bold">Min</th>
              </tr>
            </thead>
            <tbody>
              {stoppages.map((s) => {
                const live = !s.endAt;
                const mins = s.durationMin ?? (live ? elapsedMin(s.startAt) : undefined);
                return (
                  <tr
                    key={s.id}
                    className={live ? 'bg-[#FFEDD5]/40' : 'border-t border-border'}
                  >
                    <td className="px-4 py-3 font-mono font-bold text-foreground">
                      {resolveStoppageDisplayCode(s.categoryCode, s.breakdownCode)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[160px] truncate">
                      {s.remarks || s.categoryLabel}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{fmtTime(s.startAt)}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {s.endAt ? fmtTime(s.endAt) : live ? <span className="text-warning font-bold">Running</span> : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-right font-semibold">
                      {mins != null ? `${mins}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-primary bg-accent/10">
                <td colSpan={4} className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-foreground">
                  Total Stoppage
                </td>
                <td className="px-4 py-3 font-mono text-right text-lg font-bold text-foreground">
                  {totalMin} min
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
