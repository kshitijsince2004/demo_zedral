import { useEffect, useState } from 'react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { apiClient } from '../../lib/apiClient';
import { SixHiStatusPill } from './SixHiStatusPill';
import { primaryOrderId, selectIdOf } from '../../lib/sixHiOrderIdentity';
import type { CombinedProductionRun } from '../../store/sixHiStore';

interface CombinedProductionOrdersPanelProps {
  combinedRun: CombinedProductionRun;
  refreshToken?: number;
}

export function CombinedProductionOrdersPanel({
  combinedRun,
  refreshToken = 0,
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

  const totalTargetMt = combinedRun.orders.reduce((sum, o) => sum + o.weightMt, 0);

  const cards = orders.length > 0 ? orders : null;

  return (
    <div className="shrink-0 px-3 pb-2 space-y-2">
      <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-success">
          Combined production · {combinedRun.batchNumbers.length} orders
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Production fields below are shared — one entry applies to every order in this run.
        </p>
      </div>

      <div className="max-h-48 overflow-y-auto pr-1">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(cards ?? combinedRun.orders).map((order) => {
            const batchNumber = order.batchNumber;
            const detail = cards?.find((o) => o.batchNumber === batchNumber);
            const produced = detail?.rolling?.actualWeightMt ?? detail?.skinPass?.actualWeightMt;
            const targetMt = detail?.ppcWeightMt ?? ('weightMt' in order ? order.weightMt : 0);
            const status = detail?.status;

            return (
              <div key={batchNumber} className="rounded-xl border border-border bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm font-bold truncate">{primaryOrderId(order)}</span>
                  {status && <SixHiStatusPill status={status} />}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Slit ID {selectIdOf(order)} · Batch {batchNumber}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {produced != null ? `${produced} MT` : '—'} / {targetMt} MT
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground px-1">
        Combined target: {totalTargetMt.toFixed(3)} MT across {combinedRun.batchNumbers.length} orders
      </p>
    </div>
  );
}
