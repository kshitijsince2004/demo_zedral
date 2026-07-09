import { useEffect, useMemo, useState } from 'react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { apiClient } from '../../lib/apiClient';
import {
  allocateCombinedWeight,
  combinedTargetMt,
  resolveCombinedActualMt,
} from '../../lib/combinedWeightAllocation';
import { primaryOrderId, selectIdOf } from '../../lib/sixHiOrderIdentity';
import type { CombinedProductionRun } from '../../store/sixHiStore';
import { SixHiStatusPill } from './SixHiStatusPill';

interface CombinedProductionOrdersPanelProps {
  combinedRun: CombinedProductionRun;
  refreshToken?: number;
  /** Compact layout for capture / overview screens */
  variant?: 'workspace' | 'capture';
}

export function CombinedProductionOrdersPanel({
  combinedRun,
  refreshToken = 0,
  variant = 'workspace',
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
    <div className={`shrink-0 space-y-2 ${variant === 'capture' ? '' : 'px-3 pb-2'}`}>
      <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-success">
          Combined production run · {combinedRun.batchNumbers.length} linked orders
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Enter one combined actual weight — allocation fills smallest orders first, then larger units.
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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(cards ?? combinedRun.orders).map((order) => {
            const batchNumber = order.batchNumber;
            const detail = cards?.find((o) => o.batchNumber === batchNumber);
            const allocated = allocation?.get(batchNumber);
            const produced = allocated ?? detail?.rolling?.actualWeightMt ?? detail?.skinPass?.actualWeightMt;
            const targetMt = detail?.ppcWeightMt ?? ('weightMt' in order ? order.weightMt : 0);
            const status = detail?.status;

            return (
              <div key={batchNumber} className="rounded-xl border border-border bg-white p-3 relative">
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-success" title="Linked combined run" />
                <div className="flex items-start justify-between gap-2 pr-3">
                  <span className="font-mono text-sm font-bold truncate">{primaryOrderId(order)}</span>
                  {status && <SixHiStatusPill status={status} />}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Slit {selectIdOf(order)} · Batch {batchNumber}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  <span className="font-semibold text-foreground">
                    {produced != null ? `${produced} MT` : '—'}
                  </span>
                  {' '}/ {targetMt} MT
                  {allocation && produced != null && (
                    <span className="block text-[10px] text-success mt-0.5">Allocated fill</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
