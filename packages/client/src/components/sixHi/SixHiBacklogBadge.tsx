interface SixHiBacklogBadgeProps {
  planDate?: string;
  large?: boolean;
}

export function SixHiBacklogBadge({ planDate, large }: SixHiBacklogBadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full font-bold uppercase tracking-wide',
        'bg-destructive/15 text-destructive border border-destructive/25',
        large ? 'px-3 py-1.5 text-xs' : 'px-2 py-0.5 text-[9px]',
      ].join(' ')}
      title={planDate ? `Planned ${planDate}` : 'Overdue incomplete order'}
    >
      Backlog{planDate ? ` · ${planDate}` : ''}
    </span>
  );
}
