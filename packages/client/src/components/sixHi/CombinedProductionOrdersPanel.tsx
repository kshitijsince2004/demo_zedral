import { useEffect, useMemo, useState } from 'react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { apiClient } from '../../lib/apiClient';
import {
  allocateCombinedWeight,
  combinedTargetMt,
  resolveCombinedActualMt,
} from '../../lib/combinedWeightAllocation';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import type { CombinedProductionRun } from '../../store/sixHiStore';
import { SixHiStatusPill } from './SixHiStatusPill';

interface CombinedProductionOrdersPanelProps {
  combinedRun: CombinedProductionRun;
  refreshToken?: number;
  variant?: 'workspace' | 'capture';
  selectedBatch?: string | null;
  onSelectBatch?: (batchNumber: string) => void;
}

export function CombinedProductionOrdersPanel({
  combinedRun,
  refreshToken = 0,
  variant = 'workspace',
  selectedBatch,
  onSelectBatch,
}: CombinedProductionOrdersPanelProps) {
  const [orders, setOrders] = useState<SixHiOrderDetail[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await Promise.all(
        combinedRun.batchNumbers.map((batchNumber) =>
          apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`),
        ),
      );
      if (!cancelled) setOrders(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [combinedRun.batchNumbers.join(','), refreshToken]);

  const targets = combinedRun.orders.map((o) => ({
    batchNumber: o.batchNumber,
    targetMt: o.weightMt,
  }));
  const totalTargetMt = combinedTargetMt(targets.map((t) => ({ targetMt: t.targetMt })));
  const combinedActualMt = useMemo(
    () => resolveCombinedActualMt(
      orders.map((o) => o.rolling?.actualWeightMt ?? o.skinPass?.actualWeightMt),
    ),
    [orders],
  );
  const allocation = useMemo(
    () => (combinedActualMt != null ? allocateCombinedWeight(targets, combinedActualMt) : null),
    [combinedActualMt, targets],
  );

  const cards = orders.length > 0 ? orders : null;
  const balanceMt = combinedActualMt != null ? Math.max(0, totalTargetMt - combinedActualMt) : null;

  return (
    <div className={`shrink-0 space-y-2 ${variant === 'capture' ? '' : 'px-3 pt-2'}`}>
      <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-success">
          Combined production · {combinedRun.batchNumbers.length} active orders
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Tap an order card for full details. Enter one combined actual weight below.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-white/80 border border-border/50 px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Target</p>
            <p className="font-mono text-sm font-bold">{totalTargetMt.toFixed(3)} MT</p>
          </div>
          <div className="rounded-lg bg-white/80 border border-border/50 px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Produced</p>
            <p className="font-mono text-sm font-bold text-primary">
              {combinedActualMt != null ? `${combinedActualMt.toFixed(3)} MT` : '—'}
            </p>
          </div>
          <div className="rounded-lg bg-white/80 border border-border/50 px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Balance</p>
            <p className="font-mono text-sm font-bold">
              {balanceMt != null ? `${balanceMt.toFixed(3)} MT` : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className={variant === 'capture' ? 'max-h-56 overflow-y-auto' : ''}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(cards ?? combinedRun.orders).map((order) => {
            const batchNumber = order.batchNumber;
            const detail = cards?.find((o) => o.batchNumber === batchNumber);
            const allocated = allocation?.get(batchNumber);
            const produced = allocated ?? detail?.rolling?.actualWeightMt ?? detail?.skinPass?.actualWeightMt;
            const targetMt = detail?.ppcWeightMt ?? ('weightMt' in order ? order.weightMt : 0);
            const status = detail?.status;
            const isSelected = selectedBatch === batchNumber;

            return (
              <button
                key={batchNumber}
                type="button"
                onClick={() => onSelectBatch?.(batchNumber)}
                className={[
                  'rounded-xl border bg-white p-3 text-left transition-all',
                  'hover:border-primary/40 hover:shadow-sm',
                  isSelected ? 'border-primary ring-2 ring-primary/20 shadow-sm' : 'border-border',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm font-bold truncate">{displayMotherCoilId(order)}</span>
                  {status && <SixHiStatusPill status={status} />}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">Batch {batchNumber}</p>
                <p className="text-xs mt-2">
                  <span className="font-semibold text-foreground">
                    {produced != null ? `${produced} MT` : '—'}
                  </span>
                  <span className="text-muted-foreground"> / {targetMt} MT</span>
                </p>
                {isSelected && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary mt-2">Viewing details →</p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
