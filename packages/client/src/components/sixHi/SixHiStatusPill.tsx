import type { SixHiOrderStatus } from '@m1/shared-validation';

const STATUS_STYLE: Record<SixHiOrderStatus, { bg: string; text: string; label: string }> = {
  PENDING: { bg: 'bg-[#FEF9C3]', text: 'text-[#854D0E]', label: 'PENDING' },
  PREPARING: { bg: 'bg-info/15', text: 'text-info', label: 'PREPARING' },
  IN_PROGRESS: { bg: 'bg-[#FFEDD5]', text: 'text-warning', label: 'IN PROGRESS' },
  STOPPAGE: { bg: 'bg-destructive/10', text: 'text-destructive', label: 'STOPPAGE' },
  COMPLETED: { bg: 'bg-secondary', text: 'text-muted-foreground', label: 'COMPLETED' },
};

interface SixHiStatusPillProps {
  status: SixHiOrderStatus;
  preparing?: boolean;
  prepReady?: boolean;
  large?: boolean;
}

export function SixHiStatusPill({ status, preparing, prepReady, large }: SixHiStatusPillProps) {
  let s = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  if (preparing) {
    s = { bg: 'bg-info/15', text: 'text-info', label: 'PREPARING' };
  } else if (status === 'PENDING' && prepReady) {
    s = { bg: 'bg-success/15', text: 'text-success', label: 'READY' };
  }
  return (
    <span className={`inline-flex rounded-full font-bold uppercase tracking-wide ${large ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'} ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}
