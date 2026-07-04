import type { SixHiOrderDetail, SixHiQueueCard } from '@m1/shared-validation';
import { Package } from 'lucide-react';
import { finalOutputThicknessOf, finishOf, primaryOrderId, selectIdOf } from '../../lib/sixHiOrderIdentity';

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

export function PPCInfoCards({ data }: { data: PPCSource; compact?: boolean }) {
  const isRolling = 'subProcess' in data && data.subProcess === 'ROLLING';
  const batch = 'batchNumber' in data ? data.batchNumber : undefined;
  const weight = 'ppcWeightMt' in data ? data.ppcWeightMt : ('weightMt' in data ? data.weightMt : 0);

  return (
    <div className="bg-card text-card-foreground border border-border rounded-xl shadow p-4 flex flex-col">
      <div className="flex items-center justify-between mb-4 border-b border-border/50 pb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-info flex items-center gap-2">
          <Package className="w-4 h-4" /> Current Order
          <span className="text-foreground ml-1">{primaryOrderId(data)}</span>
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
          {label('Select ID')}
          <p className="text-sm font-mono font-bold text-foreground truncate">{selectIdOf(data)}</p>
        </div>
        <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
          {label('Width / Final Thk')}
          <p className="text-sm font-mono font-bold text-foreground truncate">{data.widthMm}mm / {finalOutputThicknessOf(data)}mm</p>
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
        <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
          {label('Finish')}
          <p className="text-sm font-semibold text-foreground truncate">{finishOf(data)}</p>
        </div>
        {batch && (
          <div className="bg-muted/20 rounded-lg p-2 border border-border/50">
            {label('Batch')}
            <p className="text-sm font-mono font-bold text-foreground truncate">{batch}</p>
          </div>
        )}
      </div>
    </div>
  );
}
