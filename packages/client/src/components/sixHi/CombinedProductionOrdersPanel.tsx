import { useEffect, useMemo, useState } from 'react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { apiClient } from '../../lib/apiClient';
import {
  allocateCombinedWeight,
  combinedTargetMt,
  resolveCombinedActualMt,
} from '../../lib/combinedWeightAllocation';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { useSixHiStore, type CombinedProductionRun } from '../../store/sixHiStore';
import { SixHiStatusPill } from './SixHiStatusPill';
import { ThicknessSpecs } from './ThicknessSpecs';

interface CombinedProductionOrdersPanelProps {
  combinedRun: CombinedProductionRun;
  refreshToken?: number;
  variant?: 'workspace' | 'capture';
  selectedBatch?: string | null;
  onSelectBatch?: (batchNumber: string) => void;
  /** When true, show pick-checkboxes (pre-start only). */
  selectable?: boolean;
}

export function CombinedProductionOrdersPanel({
  combinedRun,
  refreshToken = 0,
  variant = 'workspace',
  selectedBatch,
  onSelectBatch,
  selectable = false,
}: CombinedProductionOrdersPanelProps) {
  const combinedSelectedBatches = useSixHiStore((s) => s.combinedSelectedBatches);
  const combinedActualMtIntent = useSixHiStore((s) => s.combinedActualMtIntent);
  const toggleCombinedSelected = useSixHiStore((s) => s.toggleCombinedSelected);
  const [orders, setOrders] = useState<SixHiOrderDetail[]>([]);
  const batchNumbersKey = combinedRun.batchNumbers.join(',');

  useEffect(() => {
    const batchNumbers = batchNumbersKey ? batchNumbersKey.split(',') : [];
    let cancelled = false;
    void (async () => {
      const loaded = await Promise.all(
        batchNumbers.map((batchNumber) =>
          apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`),
        ),
      );
      if (!cancelled) setOrders(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [batchNumbersKey, refreshToken]);

  const targets = combinedRun.orders.map((o) => ({
    batchNumber: o.batchNumber,
    targetMt: o.weightMt,
  }));
  const totalTargetMt = combinedTargetMt(targets.map((t) => ({ targetMt: t.targetMt })));
  const savedCombinedActualMt = useMemo(
    () => resolveCombinedActualMt(
      orders.map((o) => o.rolling?.actualWeightMt ?? o.skinPass?.actualWeightMt),
    ),
    [orders],
  );
  const displayCombinedActualMt = combinedActualMtIntent ?? savedCombinedActualMt;
  const plannedAllocation = useMemo(
    () => (displayCombinedActualMt != null ? allocateCombinedWeight(targets, displayCombinedActualMt) : null),
    [displayCombinedActualMt, targets],
  );

  const cards = orders.length > 0 ? orders : null;
  const balanceMt = displayCombinedActualMt != null
    ? Math.max(0, totalTargetMt - displayCombinedActualMt)
    : null;
  const showPickers = selectable && combinedRun.batchNumbers.length >= 2;
  const pickedCount = combinedSelectedBatches.filter((b) => combinedRun.batchNumbers.includes(b)).length;

  return (
    <div className={`shrink-0 space-y-2 ${variant === 'capture' ? '' : 'px-3 pt-2'}`}>
      <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-success">
          {showPickers
            ? `Combined production · ${pickedCount} of ${combinedRun.batchNumbers.length} selected`
            : `Combined production · ${combinedRun.batchNumbers.length} active orders`}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {showPickers
            ? 'Untick orders to leave them in the queue. Start uses only the ticked set.'
            : 'Tap an order card for full details. Enter one combined actual weight below.'}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-white/80 border border-border/50 px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Target</p>
            <p className="font-mono text-sm font-bold">{totalTargetMt.toFixed(3)} MT</p>
          </div>
          <div className="rounded-lg bg-white/80 border border-border/50 px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Produced</p>
            <p className="font-mono text-sm font-bold text-primary">
              {displayCombinedActualMt != null ? `${displayCombinedActualMt.toFixed(3)} MT` : '—'}
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
            const savedMt = detail?.rolling?.actualWeightMt ?? detail?.skinPass?.actualWeightMt;
            const plannedMt = plannedAllocation?.get(batchNumber);
            const showPlanned = plannedMt != null && savedMt == null;
            const produced = savedMt ?? (showPlanned ? plannedMt : null);
            const targetMt = detail?.ppcWeightMt ?? ('weightMt' in order ? order.weightMt : 0);
            const status = detail?.status;
            const isSelected = selectedBatch === batchNumber;
            const isPicked = combinedSelectedBatches.includes(batchNumber);

            return (
              <div
                key={batchNumber}
                className={[
                  'rounded-xl border bg-white p-3 text-left transition-all',
                  'hover:border-primary/40 hover:shadow-sm',
                  isSelected ? 'border-primary ring-2 ring-primary/20 shadow-sm' : 'border-border',
                  showPickers && !isPicked ? 'opacity-70' : '',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    {showPickers && (
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                        checked={isPicked}
                        aria-label={`Include ${batchNumber} in combined start`}
                        onChange={() => toggleCombinedSelected(batchNumber)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => onSelectBatch?.(batchNumber)}
                    >
                      <span className="font-mono text-sm font-bold truncate block">{displayMotherCoilId(order)}</span>
                      <p className="text-[10px] text-muted-foreground mt-1 font-mono">Batch {batchNumber}</p>
                    </button>
                  </div>
                  {status && <SixHiStatusPill status={status} />}
                </div>
                <button type="button" className="w-full text-left" onClick={() => onSelectBatch?.(batchNumber)}>
                  <p className="text-xs mt-2">
                    <span className={`font-semibold ${showPlanned ? 'text-amber-700' : 'text-foreground'}`}>
                      {produced != null ? `${produced} MT` : '—'}
                    </span>
                    <span className="text-muted-foreground"> / {targetMt} MT</span>
                    {showPlanned && (
                      <span className="block text-[10px] text-amber-700/90 mt-0.5">Planned — save to persist</span>
                    )}
                  </p>
                  {isSelected && detail && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <ThicknessSpecs order={detail} compact />
                    </div>
                  )}
                  {isSelected && !detail && (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary mt-2">Viewing details →</p>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
