import { asDisplayText, displayMotherCoilId } from '../../lib/sixHiOrderIdentity';

type OrderIdentitySource = {
  motherCoil?: unknown;
  motherCoilNo?: unknown;
  displayCoilNo?: unknown;
  coilNo?: unknown;
  batchNumber?: unknown;
  slitId?: unknown;
};

interface OrderIdentityDisplayProps {
  order: OrderIdentitySource;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  className?: string;
}

const sizeClass = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
} as const;

export function OrderIdentityDisplay({
  order,
  size = 'md',
  showSubtitle = true,
  className = '',
}: OrderIdentityDisplayProps) {
  const coil = displayMotherCoilId(order);
  const batch = asDisplayText(order.batchNumber);

  return (
    <div className={className}>
      <span
        className={`font-mono font-bold text-primary block truncate ${sizeClass[size]}`}
        title={coil}
      >
        {coil || '—'}
      </span>
      {showSubtitle && batch && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block truncate mt-0.5">
          Batch {batch}
        </span>
      )}
    </div>
  );
}
