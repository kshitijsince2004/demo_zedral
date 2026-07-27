import type { SixHiOrderDetail } from '@m1/shared-validation';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { combinedTargetMt, resolveCombinedActualMt } from '../../lib/combinedWeightAllocation';
import { displayMotherCoilId, selectIdOf } from '../../lib/sixHiOrderIdentity';
import { OrderRejectionSection } from '../orders/OrderRejectionSection';

import {
  formatProductionDurationMin,
  resolveProductionDurationMin,
  resolveTotalStoppageMin,
  resolveWallDurationMin,
} from '../../lib/sixHiRuntime';

function producedMt(order: SixHiOrderDetail): number | undefined {
  return order.rolling?.actualWeightMt ?? order.skinPass?.actualWeightMt;
}

interface CombinedProductionHistoryProps {
  orders: SixHiOrderDetail[];
}

/** Single combined production record for a finished multi-order run. */
export function CombinedProductionHistory({ orders }: CombinedProductionHistoryProps) {
  if (orders.length === 0) return null;

  const primary = orders[0];
  const isRolling = primary.subProcess === 'ROLLING';
  const targets = orders.map((o) => ({ targetMt: o.ppcWeightMt }));
  const totalTarget = combinedTargetMt(targets);
  const combinedProduced = resolveCombinedActualMt(orders.map(producedMt));
  const startAt = orders.map((o) => o.prodStartAt).filter(Boolean).sort()[0];
  const endAt = orders.map((o) => o.prodEndAt).filter(Boolean).sort().reverse()[0];
  const runningMin = Math.max(...orders.map((o) => resolveProductionDurationMin(o) ?? 0));
  const stoppageMin = orders.reduce((sum, o) => sum + resolveTotalStoppageMin(o), 0);
  const wallMin = Math.max(...orders.map((o) => resolveWallDurationMin(o) ?? 0));
  const allRejected = orders.every((o) => o.status === 'REJECTED');

  return (
    <div className="space-y-4 border-t border-border pt-4 mt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Combined Production History
        </p>
        <span className="text-[10px] font-bold uppercase tracking-widest text-success bg-success/10 px-2 py-0.5 rounded">
          {orders.length} orders · one run
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div className="col-span-2">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Linked orders</dt>
          <dd className="font-mono text-xs font-semibold mt-1">
            {orders.map((o) => displayMotherCoilId(o)).join(' · ')}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Running Duration</dt>
          <dd className="font-mono font-semibold">{formatProductionDurationMin(runningMin)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Stoppage Duration</dt>
          <dd className="font-mono font-semibold">{formatProductionDurationMin(stoppageMin)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Duration</dt>
          <dd className="font-mono font-semibold">{formatProductionDurationMin(wallMin)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Combined target</dt>
          <dd className="font-mono font-semibold">{totalTarget} MT</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Start</dt>
          <dd className="font-mono text-xs">{startAt ? formatPlantDateTime(startAt) : '—'}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">End</dt>
          <dd className="font-mono text-xs">{endAt ? formatPlantDateTime(endAt) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Combined produced</dt>
          <dd className="font-mono font-semibold text-primary">
            {combinedProduced != null ? `${combinedProduced} MT` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Balance</dt>
          <dd className="font-mono font-semibold">
            {combinedProduced != null ? `${Math.max(0, roundMt(totalTarget - combinedProduced))} MT` : '—'}
          </dd>
        </div>
      </dl>

      <div className="rounded-xl border border-border bg-secondary/30 overflow-hidden">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-3 py-2 border-b border-border/60">
          Per-order fill allocation
        </p>
        <ul className="divide-y divide-border/60">
          {orders.map((order) => {
            const produced = producedMt(order);
            return (
              <li key={order.batchNumber} className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-mono font-bold text-primary truncate">{displayMotherCoilId(order)}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Slit {selectIdOf(order)} · Batch {order.batchNumber}
                  </p>
                </div>
                <p className="font-mono text-xs font-semibold shrink-0">
                  {produced != null ? `${produced} MT` : '—'} / {order.ppcWeightMt} MT
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      {isRolling && primary.rolling && (
        <div className="rounded-xl bg-secondary/50 p-3 space-y-1 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Rolling (shared)</p>
          <p>Destination: {primary.rolling.destination === 'REWINDING' ? 'Rewinding' : 'Annealing'}</p>
          {primary.rolling.passes.length > 0 && (
            <p className="font-mono text-xs">
              Passes: {primary.rolling.passes.map((p) => `P${p.passNo} ${p.thicknessMm}mm`).join(' · ')}
            </p>
          )}
          {primary.rolling.associateRw && <p>Rewinder: {primary.rolling.associateRw}</p>}
        </div>
      )}

      {!isRolling && primary.skinPass && (
        <div className="rounded-xl bg-secondary/50 p-3 space-y-1 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Skin Pass (shared)</p>
          {primary.skinPass.outputThkMm != null && <p>Output: {primary.skinPass.outputThkMm} mm</p>}
          {primary.skinPass.annHard != null && <p>Ann Hard: {primary.skinPass.annHard}</p>}
          {(primary.skinPass.rwTension1 != null || primary.skinPass.rwTension2 != null) && (
            <p>SP Tension: {primary.skinPass.rwTension1 ?? '—'}/{primary.skinPass.rwTension2 ?? '—'}</p>
          )}
        </div>
      )}

      {allRejected && orders.map((order) =>
        order.rejection ? (
          <OrderRejectionSection key={order.batchNumber} rejection={order.rejection} />
        ) : null,
      )}
    </div>
  );
}

function roundMt(value: number): number {
  return Math.round(value * 1000) / 1000;
}
