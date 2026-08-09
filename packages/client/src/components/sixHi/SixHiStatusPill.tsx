import type { SixHiOrderStatus } from '@m1/shared-validation';
import { formatOrderStatusLabel } from '../../lib/orderLabels';

const STATUS_STYLE: Record<SixHiOrderStatus, { bg: string; text: string }> = {
  PENDING: { bg: 'bg-[#FEF9C3]', text: 'text-[#854D0E]' },
  PREPARING: { bg: 'bg-info/15', text: 'text-info' },
  IN_PROGRESS: { bg: 'bg-[#FFEDD5]', text: 'text-warning' },
  STOPPAGE: { bg: 'bg-destructive/10', text: 'text-destructive' },
  COMPLETED: { bg: 'bg-secondary', text: 'text-muted-foreground' },
  REJECTED: { bg: 'bg-accent/15', text: 'text-accent-foreground' },
};

interface SixHiStatusPillProps {
  status: SixHiOrderStatus;
  preparing?: boolean;
  prepReady?: boolean;
  large?: boolean;
}

export function SixHiStatusPill({ status, preparing, prepReady, large }: SixHiStatusPillProps) {
  let s = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  let label = formatOrderStatusLabel(status);
  if (preparing) {
    s = { bg: 'bg-info/15', text: 'text-info' };
    label = 'Preparing';
  } else if (status === 'PENDING' && prepReady) {
    s = { bg: 'bg-success/15', text: 'text-success' };
    label = 'Ready';
  }
  return (
    <span className={`inline-flex rounded-full font-bold uppercase tracking-wide ${large ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'} ${s.bg} ${s.text}`}>
      {label}
    </span>
  );
}
