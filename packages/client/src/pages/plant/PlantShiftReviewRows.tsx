// PERF-B1/B3 — memo rows extracted from PlantShiftReviewPage
import { memo } from 'react';

export const CompletedOrderRow = memo(function CompletedOrderRow({
  o,
}: {
  o: { batchNumber: string; customer?: string; weightMt: number };
}) {
  return (
    <li className="flex justify-between gap-2 px-3 py-2 bg-white/40">
      <span className="font-mono font-semibold">{o.batchNumber}</span>
      <span className="text-muted-foreground truncate flex-1">{o.customer ?? '—'}</span>
      <span className="font-mono">{o.weightMt} MT</span>
    </li>
  );
});

export const InProgressOrderRow = memo(function InProgressOrderRow({
  o,
}: {
  o: { batchNumber: string; status: string; machineCode?: string };
}) {
  return (
    <li className="flex justify-between gap-2 px-3 py-2 bg-white/40">
      <span className="font-mono font-semibold">{o.batchNumber}</span>
      <span className="text-muted-foreground">{o.machineCode ?? '—'}</span>
      <span>{o.status.replace(/_/g, ' ')}</span>
    </li>
  );
});

export function formatMinutes(min?: number): string {
  if (min == null || min < 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const StoppageReviewRow = memo(function StoppageReviewRow({
  s,
}: {
  s: {
    id: string;
    batchNumber: string;
    categoryLabel: string;
    endAt?: string;
    durationMin?: number;
  };
}) {
  return (
    <li className="flex justify-between gap-2 px-3 py-2 bg-white/40">
      <span className="font-medium">{s.categoryLabel}</span>
      <span className="text-muted-foreground truncate flex-1">{s.batchNumber}</span>
      <span className="font-mono">{formatMinutes(s.durationMin)}</span>
      <span className={s.endAt ? 'text-muted-foreground' : 'text-destructive font-medium'}>
        {s.endAt ? 'Ended' : 'Active'}
      </span>
    </li>
  );
});
