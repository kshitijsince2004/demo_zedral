import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';

type OrderIdentitySource = {
  motherCoil?: string;
  motherCoilNo?: string;
  displayCoilNo?: string;
  coilNo?: string;
  batchNumber: string;
  slitId?: string;
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

  return (
    <div className={className}>
      <span
        className={`font-mono font-bold text-primary block truncate ${sizeClass[size]}`}
        title={coil}
      >
        {coil}
      </span>
      {showSubtitle && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block truncate mt-0.5">
          Batch {order.batchNumber}
        </span>
      )}
    </div>
  );
}
