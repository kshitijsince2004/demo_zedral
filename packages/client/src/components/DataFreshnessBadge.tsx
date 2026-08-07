import { getServerTime } from '../lib/apiClient';

function formatAsOf(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Tier-3 freshness badge — "as of HH:MM" from server-skewed clock (PERF-D5). */
export function DataFreshnessBadge({
  updatedAt,
  className = '',
}: {
  updatedAt?: number | string | Date | null;
  className?: string;
}) {
  let when: Date;
  if (updatedAt == null) {
    when = new Date(getServerTime());
  } else if (updatedAt instanceof Date) {
    when = updatedAt;
  } else if (typeof updatedAt === 'number') {
    when = new Date(updatedAt);
  } else {
    when = new Date(updatedAt);
  }
  if (Number.isNaN(when.getTime())) when = new Date(getServerTime());

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground ${className}`}
      title="Data may be stale until the next refresh"
    >
      as of {formatAsOf(when)}
    </span>
  );
}
