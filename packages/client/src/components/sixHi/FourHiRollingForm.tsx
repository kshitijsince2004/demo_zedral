import { useState } from 'react';
import type { SixHiOrderDetail, SixHiRollingData } from '@m1/shared-validation';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { PassTracker } from './PassTracker';

interface RollingWorkspaceProps {
  order: SixHiOrderDetail;
  onSave: (data: SixHiRollingData) => Promise<void>;
  busy?: boolean;
  compact?: boolean;
}

function buildInitialRolling(order: SixHiOrderDetail): SixHiRollingData {
  const ppcDest = order.ppcDestination ?? 'ANNEALING';
  if (order.rolling) return order.rolling;

  const passNo = order.rollingPassNo ?? 1;
  const passTarget = order.targetThkMm;
  const existingPasses = order.rollingPassPlans?.length
    ? order.rollingPassPlans
        .filter((p) => p.passNo <= passNo && p.targetThkMm != null)
        .map((p) => ({ passNo: p.passNo, thicknessMm: p.targetThkMm! }))
    : passTarget
      ? [{ passNo, thicknessMm: passTarget }]
      : [];

  return {
    destination: ppcDest,
    destinationOverride: false,
    passes: existingPasses,
    totalPasses: existingPasses.length,
  };
}

export function FourHiRollingForm({ order, onSave, busy, compact }: RollingWorkspaceProps) {
  const ppcDest = order.ppcDestination ?? 'ANNEALING';
  const initial = buildInitialRolling(order);

  const [data, setData] = useState<SixHiRollingData>(initial);
  const [overrideDest, setOverrideDest] = useState(initial.destinationOverride);
  const locked = order.status === 'COMPLETED';
  const effectiveDest = overrideDest ? data.destination : ppcDest;

  const finalThk = data.passes.length > 0 ? data.passes[data.passes.length - 1].thicknessMm : data.finalThkMm;

  const save = () =>
    onSave({
      ...data,
      destination: effectiveDest,
      destinationOverride: overrideDest,
      totalPasses: data.passes.length,
      finalThkMm: finalThk,
    });

  const passLabel = order.rollingPassNo && order.rollingPassNo > 1
    ? `Re-roll pass ${order.rollingPassNo}`
    : order.ppcRerollFlag
      ? 'Re-roll'
      : null;

  if (compact) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 min-h-0 flex-1 h-full overflow-hidden">
        <div className="bg-white border border-border rounded-xl p-3 flex flex-col gap-2 min-h-0">
          <h3 className="text-base font-bold text-foreground shrink-0">
            Production{passLabel ? ` · ${passLabel}` : ''}
          </h3>
          {order.finishThkMm != null && order.finishThkMm !== order.targetThkMm && (
            <p className="text-xs text-muted-foreground shrink-0">
              Pass target {order.targetThkMm} mm · Finish {order.finishThkMm} mm
            </p>
          )}
          <FieldWrapper label="Actual Weight (Metric Tons)" prominent>
            <ZInput
              type="number"
              inputMode="decimal"
              enterKeyHint="next"
              autoComplete="off"
              value={data.actualWeightMt ?? ''}
              onChange={(e) => setData({ ...data, actualWeightMt: e.target.value ? Number(e.target.value) : undefined })}
              className="min-h-14 text-xl"
              disabled={locked}
            />
          </FieldWrapper>
          <div className="flex items-center justify-between gap-1 shrink-0">
            <span className="text-sm font-medium text-muted-foreground">
              Destination: {effectiveDest === 'REWINDING' ? 'Rewinding' : 'Annealing'}
            </span>
            {!overrideDest ? (
              <button type="button" className="text-sm font-bold text-foreground underline" onClick={() => setOverrideDest(true)}>Override</button>
            ) : (
              <div className="flex gap-1">
                {(['ANNEALING', 'REWINDING'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setData({ ...data, destination: d })}
                    disabled={locked}
                    className={[
                      'min-h-11 px-3 rounded-lg border text-sm font-bold',
                      data.destination === d ? 'bg-primary text-white' : 'border-border',
                    ].join(' ')}
                  >
                    {d === 'ANNEALING' ? 'Annealing' : 'Rewinding'}
                  </button>
                ))}
              </div>
            )}
          </div>
          {effectiveDest === 'ANNEALING' && (
            <div className="grid grid-cols-2 gap-1.5">
              <FieldWrapper label="Entry Tension">
                <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={data.etr ?? ''} onChange={(e) => setData({ ...data, etr: e.target.value ? Number(e.target.value) : undefined })} className="min-h-11 text-base" disabled={locked} />
              </FieldWrapper>
              <FieldWrapper label="Delivery Tension">
                <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={data.dtr ?? ''} onChange={(e) => setData({ ...data, dtr: e.target.value ? Number(e.target.value) : undefined })} className="min-h-11 text-base" disabled={locked} />
              </FieldWrapper>
            </div>
          )}
          {effectiveDest === 'REWINDING' && (
            <FieldWrapper label="Associate Rewinder" prominent>
              <ZInput inputMode="text" enterKeyHint="next" placeholder="Rewinder reference" value={data.associateRw ?? ''} onChange={(e) => setData({ ...data, associateRw: e.target.value })} className="min-h-12 text-lg" disabled={locked} />
            </FieldWrapper>
          )}
          <ZButton variant="accent" size="sm" fullWidth onClick={save} disabled={busy || locked} className="min-h-14 text-base font-bold mt-auto shrink-0">
            Save
          </ZButton>
        </div>

        <div className="bg-white border border-border rounded-xl p-3 min-h-0 flex flex-col">
          <PassTracker passes={data.passes} onChange={(passes) => setData({ ...data, passes })} disabled={locked} compact />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-primary text-white px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Sub-process</p>
        <h2 className="text-lg font-bold">
          Rolling Production{passLabel ? ` · ${passLabel}` : ''}
        </h2>
        {order.finishThkMm != null && order.finishThkMm !== order.targetThkMm && (
          <p className="text-sm opacity-90 mt-1">
            Pass target {order.targetThkMm} mm · Finish {order.finishThkMm} mm
          </p>
        )}
      </div>
      <div className="bg-white border border-border rounded-2xl p-4">
        <FieldWrapper label="Actual Weight (Metric Tons)">
          <ZInput type="number" inputMode="decimal" enterKeyHint="next" autoComplete="off" value={data.actualWeightMt ?? ''} onChange={(e) => setData({ ...data, actualWeightMt: e.target.value ? Number(e.target.value) : undefined })} className="min-h-14 text-lg" disabled={locked} />
        </FieldWrapper>
      </div>
      <PassTracker passes={data.passes} onChange={(passes) => setData({ ...data, passes })} disabled={locked} />
      <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Destination</h3>
          <span className="text-xs text-muted-foreground">PPC: {ppcDest === 'REWINDING' ? 'Rewinding' : 'Annealing'}</span>
        </div>
        {!overrideDest ? (
          <p className="text-sm text-muted-foreground">
            Using PPC destination.{' '}
            <button type="button" className="text-foreground font-semibold underline" onClick={() => setOverrideDest(true)}>Override</button>
          </p>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {(['ANNEALING', 'REWINDING'] as const).map((d) => (
              <button key={d} type="button" onClick={() => setData({ ...data, destination: d })} disabled={locked} className={['min-h-14 px-4 rounded-xl border text-sm font-semibold', data.destination === d ? 'bg-primary text-white border-primary' : 'border-border bg-white'].join(' ')}>
                {d === 'ANNEALING' ? 'Annealing' : 'Rewinding'}
              </button>
            ))}
          </div>
        )}
        {data.destination === 'ANNEALING' && (
          <div className="grid grid-cols-2 gap-3">
            <FieldWrapper label="Entry Tension"><ZInput type="number" inputMode="decimal" enterKeyHint="next" value={data.etr ?? ''} onChange={(e) => setData({ ...data, etr: e.target.value ? Number(e.target.value) : undefined })} className="min-h-14 text-lg" disabled={locked} /></FieldWrapper>
            <FieldWrapper label="Delivery Tension"><ZInput type="number" inputMode="decimal" enterKeyHint="next" value={data.dtr ?? ''} onChange={(e) => setData({ ...data, dtr: e.target.value ? Number(e.target.value) : undefined })} className="min-h-14 text-lg" disabled={locked} /></FieldWrapper>
          </div>
        )}
        {data.destination === 'REWINDING' && (
          <FieldWrapper label="Associate Rewinder"><ZInput value={data.associateRw ?? ''} onChange={(e) => setData({ ...data, associateRw: e.target.value })} className="min-h-14" disabled={locked} /></FieldWrapper>
        )}
      </div>
      <ZButton variant="accent" size="lg" fullWidth onClick={save} disabled={busy || locked} className="min-h-14">Save Production Data</ZButton>
    </div>
  );
}
