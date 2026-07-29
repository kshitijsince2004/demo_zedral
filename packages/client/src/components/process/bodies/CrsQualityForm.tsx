import { useState } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture } from '../../../store/processStore';
import type { BodyProps } from '../../../lib/processConfig';

const SLOTS = ['A', 'B', 'C', 'D'] as const;

export function CrsQualityForm({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const [hardnessVpn, setHardnessVpn] = useState<number | ''>('');
  const [uts, setUts] = useState<number | ''>('');
  const [elongation, setElongation] = useState<number | ''>('');
  const [ra, setRa] = useState<number | ''>('');
  const [rz, setRz] = useState<number | ''>('');
  const [camber, setCamber] = useState('');
  const [forCtlMt, setForCtlMt] = useState<number | ''>('');
  const [outputWt, setOutputWt] = useState(Number(prefill.weightMt ?? 0));
  const [slots, setSlots] = useState<Array<{ slot: typeof SLOTS[number]; widthMm?: number; childCoilNo: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  function addSlot(label: typeof SLOTS[number]) {
    if (slots.some((s) => s.slot === label)) return;
    setSlots([...slots, { slot: label, childCoilNo: `${coilNo}-${label}` }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/crs', {
        machineCode,
        shiftLogId,
        coilNo,
        coilWidthMm: Number(prefill.widthMm ?? 0),
        nominalThkMm: Number(prefill.thicknessMm ?? 0),
        hardnessVpn: hardnessVpn === '' ? undefined : Number(hardnessVpn),
        utsNmm2: uts === '' ? undefined : Number(uts),
        elongationPct: elongation === '' ? undefined : Number(elongation),
        raUm: ra === '' ? undefined : Number(ra),
        rzUm: rz === '' ? undefined : Number(rz),
        camberWaviness: camber || undefined,
        forCtlMt: forCtlMt === '' ? undefined : Number(forCtlMt),
        outputWtMt: outputWt,
        slitSlots: slots.map((s) => ({
          slot: s.slot,
          widthMm: s.widthMm,
          childCoilNo: s.childCoilNo,
        })),
      }, coilNo);
      onSubmitted?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <p className="text-sm font-medium">Quality · {coilNo}</p>
      <div className="grid grid-cols-2 gap-3">
        <ZInput label="Hardness VPN" type="number" value={hardnessVpn} onChange={(e) => setHardnessVpn(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="UTS N/mm²" type="number" value={uts} onChange={(e) => setUts(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="Elongation %" type="number" value={elongation} onChange={(e) => setElongation(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="Ra µm" type="number" value={ra} onChange={(e) => setRa(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="Rz µm" type="number" value={rz} onChange={(e) => setRz(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="Camber / Waviness" value={camber} onChange={(e) => setCamber(e.target.value)} />
        <ZInput label="For CTL MT" type="number" value={forCtlMt} onChange={(e) => setForCtlMt(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="Output WT MT" type="number" value={outputWt} onChange={(e) => setOutputWt(Number(e.target.value))} />
      </div>

      <div className="flex gap-2">
        {SLOTS.map((label) => (
          <ZButton key={label} type="button" variant="secondary" onClick={() => addSlot(label)} disabled={slots.some((s) => s.slot === label)}>
            + Slit {label}
          </ZButton>
        ))}
      </div>

      {slots.map((slot) => (
        <div key={slot.slot} className="grid grid-cols-3 gap-2 border rounded-lg p-2">
          <span className="font-medium">{slot.slot}</span>
          <span className="text-sm">{slot.childCoilNo}</span>
          <ZInput label="Width mm" type="number" value={slot.widthMm ?? ''} onChange={(e) => {
            setSlots(slots.map((s) => s.slot === slot.slot ? { ...s, widthMm: Number(e.target.value) } : s));
          }} />
        </div>
      ))}

      <ZButton type="submit" disabled={submitting}>Submit CRS</ZButton>
    </form>
  );
}
