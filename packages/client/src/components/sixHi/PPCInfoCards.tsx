import type { SixHiOrderDetail, SixHiQueueCard } from '@m1/shared-validation';
import { Package, ArrowRightCircle } from 'lucide-react';

type PPCSource = Pick<
  SixHiOrderDetail,
  | 'batchNumber'
  | 'motherCoil'
  | 'slitId'
  | 'customer'
  | 'grade'
  | 'widthMm'
  | 'inputThkMm'
  | 'targetThkMm'
  | 'ppcWeightMt'
  | 'subProcess'
  | 'ppcDestination'
  | 'ppcRollFinish'
  | 'ppcRerollFlag'
> | SixHiQueueCard;

function label(v: string) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-0.5">{v}</span>
  );
}

export function PPCInfoCards({ data, compact }: { data: PPCSource; compact?: boolean }) {
  const isRolling = 'subProcess' in data && data.subProcess === 'ROLLING';
  const batch = 'batchNumber' in data ? data.batchNumber : undefined;
  const weight = 'ppcWeightMt' in data ? data.ppcWeightMt : ('weightMt' in data ? data.weightMt : 0);

  // Simulated Next Prepared Order for demonstration
  const nextOrder = {
    batchNumber: 'B-NXT-0922',
    customer: 'Toyota Manufacturing',
    grade: data.grade || 'CR-DP600',
    plannedQty: '12.4 MT',
    sequence: 2,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Current Running Order Panel */}
      <div className="bg-card border border-border rounded-xl shadow-sm p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4 border-b border-border/50 pb-2">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-info flex items-center gap-2">
            <Package className="w-4 h-4" /> Current Order
            {batch && <span className="text-foreground ml-1">{batch}</span>}
          </h3>
          <span className="text-[9px] uppercase font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">Active</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
            {label('Customer')}
            <p className="text-sm font-semibold text-foreground truncate">{data.customer}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
            {label('Grade')}
            <p className="text-sm font-mono font-bold text-foreground truncate">{data.grade}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
            {label('Mother Coil')}
            <p className="text-sm font-mono font-bold text-foreground truncate">{data.motherCoil}{data.slitId ? `/${data.slitId}` : ''}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
            {label('Width / Thk')}
            <p className="text-sm font-mono font-bold text-foreground truncate">{data.widthMm}mm / {data.inputThkMm}→{data.targetThkMm}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
            {label('Target Wt')}
            <p className="text-sm font-mono font-bold text-foreground truncate">{weight} MT</p>
          </div>
          {isRolling && 'ppcDestination' in data && (
            <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
              {label('Destination')}
              <p className="text-sm font-semibold text-foreground truncate">
                {data.ppcDestination === 'REWINDING' ? 'Rewinding' : 'Annealing'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Next Prepared Order Panel */}
      <div className="bg-card border border-border border-dashed rounded-xl shadow-sm p-4 flex flex-col relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>
        <div className="flex items-center justify-between mb-4 border-b border-border/50 pb-2 relative z-10">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <ArrowRightCircle className="w-4 h-4 text-primary" /> Next Prepared Order
          </h3>
          <span className="text-[9px] uppercase font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">Seq #{nextOrder.sequence}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 relative z-10">
          <div className="bg-background rounded-lg p-2 border border-border">
            {label('Order No')}
            <p className="text-sm font-mono font-bold text-foreground">{nextOrder.batchNumber}</p>
          </div>
          <div className="bg-background rounded-lg p-2 border border-border">
            {label('Customer')}
            <p className="text-sm font-semibold text-foreground truncate">{nextOrder.customer}</p>
          </div>
          <div className="bg-background rounded-lg p-2 border border-border">
            {label('Grade')}
            <p className="text-sm font-mono font-bold text-foreground">{nextOrder.grade}</p>
          </div>
          <div className="bg-background rounded-lg p-2 border border-border">
            {label('Planned Wt')}
            <p className="text-sm font-mono font-bold text-foreground">{nextOrder.plannedQty}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
