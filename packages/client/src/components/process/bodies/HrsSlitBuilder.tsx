import { useMemo, useState } from 'react';
import { calculateScrapPct } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture } from '../../../store/processStore';
import type { BodyProps } from '../../../lib/processConfig';

const SLOTS = ['A', 'B', 'C', 'D'] as const;

interface SlitSlot {
  slot: typeof SLOTS[number];
  widthMm?: number;
  thkMm?: number;
  taper?: string;
  childCoilNo: string;
}

export function HrsSlitBuilder({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const [motherWidth, setMotherWidth] = useState(Number(prefill.widthMm ?? 0));
  const [weightMt, setWeightMt] = useState(Number(prefill.weightMt ?? 0));
  const [scrapMt, setScrapMt] = useState(0);
  const [slots, setSlots] = useState<SlitSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const scrapPct = useMemo(() => calculateScrapPct(scrapMt, weightMt), [scrapMt, weightMt]);

  const childTotal = slots.reduce((s, sl) => s + (sl.widthMm ?? 0), 0);
  const massBalanceWarn = motherWidth > 0 && Math.abs(childTotal + scrapMt * 1000 / (weightMt || 1) - motherWidth) > motherWidth * 0.02;

  function addSlot(label: typeof SLOTS[number]) {
    if (slots.some((s) => s.slot === label)) return;
    setSlots([...slots, { slot: label, childCoilNo: `${coilNo}-${label}` }]);
  }

  function updateSlot(label: typeof SLOTS[number], patch: Partial<SlitSlot>) {
    setSlots(slots.map((s) => (s.slot === label ? { ...s, ...patch, childCoilNo: `${coilNo}-${label}` } : s)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/hrs', {
        machineCode,
        shiftLogId,
        coilNo,
        nominalWidthMm: motherWidth,
        actualWidthMm: motherWidth,
        nominalThkMm: Number(prefill.thicknessMm ?? 0),
        weightMt,
        scrapMt,
        slitSlots: slots.map((s) => ({
          slot: s.slot,
          widthMm: s.widthMm,
          thkMm: s.thkMm,
          taper: s.taper,
          childCoilNo: s.childCoilNo,
        })),
      }, coilNo);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <ReadOnly label="Coil No" value={coilNo} />
        <ReadOnly label="Grade" value={String(prefill.gradeCode ?? '—')} />
        <ZInput label="Mother Width mm" type="number" value={motherWidth} onChange={(e) => setMotherWidth(Number(e.target.value))} />
        <ZInput label="Weight MT" type="number" value={weightMt} onChange={(e) => setWeightMt(Number(e.target.value))} />
        <ZInput label="Scrap MT" type="number" value={scrapMt} onChange={(e) => setScrapMt(Number(e.target.value))} />
        <ReadOnly label="Scrap %" value={scrapPct.toFixed(2)} />
      </div>

      <div className="flex gap-2">
        {SLOTS.map((label) => (
          <ZButton key={label} type="button" variant="secondary" onClick={() => addSlot(label)} disabled={slots.some((s) => s.slot === label)}>
            + Slit {label}
          </ZButton>
        ))}
      </div>

      {massBalanceWarn && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Mass-balance warning: slit widths + scrap deviate from mother width.
        </p>
      )}

      {slots.map((slot) => (
        <div key={slot.slot} className="border rounded-xl p-3 grid grid-cols-2 gap-2">
          <ReadOnly label="Slot" value={slot.slot} />
          <ReadOnly label="Child Coil" value={slot.childCoilNo} />
          <ZInput label="Width mm" type="number" value={slot.widthMm ?? ''} onChange={(e) => updateSlot(slot.slot, { widthMm: Number(e.target.value) })} />
          <ZInput label="Thk mm" type="number" value={slot.thkMm ?? ''} onChange={(e) => updateSlot(slot.slot, { thkMm: Number(e.target.value) })} />
          <ZInput label="Taper" value={slot.taper ?? ''} onChange={(e) => updateSlot(slot.slot, { taper: e.target.value })} />
        </div>
      ))}

      {error && <p className="text-destructive text-sm">{error}</p>}
      <ZButton type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit HRS'}</ZButton>
    </form>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-secondary/40 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
