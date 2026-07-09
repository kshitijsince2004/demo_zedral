import type { OrderRejectionInfo } from '@m1/shared-validation';
import { formatPlantDateTime } from '../../lib/dateFormat';

interface OrderRejectionSectionProps {
  rejection: OrderRejectionInfo;
}

export function OrderRejectionSection({ rejection }: OrderRejectionSectionProps) {
  return (
    <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 space-y-2 text-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">Rejected Order</p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Reason</dt>
          <dd className="font-semibold text-foreground">{rejection.reason}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Rejected By</dt>
          <dd className="font-semibold">{rejection.rejectedBy ?? '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Rejected At</dt>
          <dd className="font-mono text-xs">{formatPlantDateTime(rejection.rejectedAt)}</dd>
        </div>
        {rejection.remarks && (
          <div className="sm:col-span-2">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Remarks</dt>
            <dd className="text-foreground">{rejection.remarks}</dd>
          </div>
        )}
        {rejection.defectCodes && rejection.defectCodes.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Defect Codes</dt>
            <dd className="font-mono text-xs">{rejection.defectCodes.join(', ')}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
