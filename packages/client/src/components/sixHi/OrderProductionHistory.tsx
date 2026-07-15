import type { SixHiOrderDetail } from '@m1/shared-validation';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { ORDER_HOLD_STATUS_LABEL } from '../../lib/orderLabels';
import { selectIdOf } from '../../lib/sixHiOrderIdentity';
import { OrderRejectionSection } from '../orders/OrderRejectionSection';

function formatDuration(min?: number): string {
  if (min == null || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface OrderProductionHistoryProps {
  order: SixHiOrderDetail;
}

export function OrderProductionHistory({ order }: OrderProductionHistoryProps) {
  const isRolling = order.subProcess === 'ROLLING';
  const producedMt = order.rolling?.actualWeightMt ?? order.skinPass?.actualWeightMt;

  return (
    <div className="space-y-4 border-t border-border pt-4 mt-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Production History</p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Slit ID</dt>
          <dd className="font-mono font-semibold">{selectIdOf(order)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Duration</dt>
          <dd className="font-mono font-semibold">{formatDuration(order.prodDurationMin)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {isRolling ? 'Input Thickness' : 'Pre-Stage Thickness'}
          </dt>
          <dd className="font-mono font-semibold">{order.inputThkMm} mm</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Target Thickness</dt>
          <dd className="font-mono font-semibold">{order.targetThkMm} mm</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Start</dt>
          <dd className="font-mono text-xs">{order.prodStartAt ? formatPlantDateTime(order.prodStartAt) : '—'}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">End</dt>
          <dd className="font-mono text-xs">{order.prodEndAt ? formatPlantDateTime(order.prodEndAt) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Produced</dt>
          <dd className="font-mono font-semibold">{producedMt != null ? `${producedMt} MT` : '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Target Weight</dt>
          <dd className="font-mono font-semibold">{order.ppcWeightMt} MT</dd>
        </div>
      </dl>

      {isRolling && order.rolling && (
        <div className="rounded-xl bg-secondary/50 p-3 space-y-1 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Rolling</p>
          <p>Destination: {order.rolling.destination === 'REWINDING' ? 'Rewinding' : 'Annealing'}</p>
          {order.rolling.passes.length > 0 && (
            <p className="font-mono text-xs">
              Passes: {order.rolling.passes.map((p) => `P${p.passNo} ${p.thicknessMm}mm`).join(' · ')}
              {order.rolling.totalPasses != null ? ` · ${order.rolling.totalPasses} total` : ''}
            </p>
          )}
          {order.rolling.finalThkMm != null && <p>Final thickness: {order.rolling.finalThkMm} mm</p>}
          {(order.rolling.etr != null || order.rolling.dtr != null) && (
            <p>ETR/DTR: {order.rolling.etr ?? '—'} / {order.rolling.dtr ?? '—'}</p>
          )}
          {order.rolling.associateRw && <p>Rewinder: {order.rolling.associateRw}</p>}
        </div>
      )}

      {!isRolling && order.skinPass && (
        <div className="rounded-xl bg-secondary/50 p-3 space-y-1 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Skin Pass</p>
          {order.skinPass.outputThkMm != null && <p>Output: {order.skinPass.outputThkMm} mm</p>}
          {order.skinPass.stretchPct != null && <p>Stretch: {order.skinPass.stretchPct}%</p>}
          {order.skinPass.annHard != null && <p>Ann Hard: {order.skinPass.annHard}</p>}
          {(order.skinPass.rwTension1 != null || order.skinPass.rwTension2 != null) && (
            <p>SP Tension: {order.skinPass.rwTension1 ?? '—'}/{order.skinPass.rwTension2 ?? '—'}</p>
          )}
          {(order.skinPass.loadMinT != null || order.skinPass.loadMaxT != null) && (
            <p>Load: {order.skinPass.loadMinT ?? '—'}–{order.skinPass.loadMaxT ?? '—'} T</p>
          )}
          {order.skinPass.operatingMode && <p>Mode: {order.skinPass.operatingMode}</p>}
        </div>
      )}

      {order.status === 'REJECTED' && order.rejection && (
        <OrderRejectionSection rejection={order.rejection} />
      )}

      {order.status === 'REJECTED' && !order.rejection && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive font-semibold">
          {ORDER_HOLD_STATUS_LABEL}
        </div>
      )}

      {order.remarks.some((r) => r.defects?.length) && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Defects</p>
          <ul className="space-y-2 text-sm">
            {order.remarks.flatMap((r) =>
              (r.defects ?? []).map((d, i) => {
                const code = typeof d === 'string' ? d : d.defectCode;
                const qty = typeof d === 'string' ? undefined : d.quantityAffected;
                const note = typeof d === 'string' ? undefined : d.remarks;
                const label = code.startsWith('OTHER:') ? `Other: ${code.slice(6)}` : code;
                return (
                  <li key={`${r.id}-${code}-${i}`} className="rounded-lg border border-border px-3 py-2 font-mono text-xs">
                    {label}
                    {qty != null ? ` · Qty ${qty}` : ''}
                    {note ? ` · ${note}` : ''}
                  </li>
                );
              }),
            )}
          </ul>
        </div>
      )}

      {order.rollChanges.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Roll Changes</p>
          <ul className="space-y-1 text-xs">
            {order.rollChanges.slice(0, 5).map((rc) => (
              <li key={rc.id} className="text-muted-foreground">
                {rc.rollPosition} roll → {rc.newRollNo}
                {rc.operatorName ? ` · ${rc.operatorName}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {order.remarks.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Remarks</p>
          <ul className="space-y-2 text-sm">
            {order.remarks.map((r) => (
              <li key={r.id} className="rounded-lg border border-border px-3 py-2">
                <p>{r.text}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatPlantDateTime(r.createdAt)}
                  {r.operatorName ? ` · ${r.operatorName}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {order.stoppages.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Stoppages</p>
          <ul className="space-y-1 text-xs font-mono">
            {order.stoppages.map((s) => (
              <li key={s.id} className="text-muted-foreground">
                {s.categoryLabel} · {formatDuration(s.durationMin)}
                {s.startAt ? ` · ${formatPlantDateTime(s.startAt)}` : ''}
                {s.endAt ? ` → ${formatPlantDateTime(s.endAt)}` : ''}
                {s.remarks ? ` · ${s.remarks}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
