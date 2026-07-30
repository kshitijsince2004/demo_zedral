import { useState } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture } from '../../../store/processStore';
import type { BodyProps } from '../../../lib/processConfig';

export function PklCoilForm({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const [lineSpeed, setLineSpeed] = useState<number | ''>('');
  const [heatNo, setHeatNo] = useState(String(prefill.heatNo ?? ''));
  const [source, setSource] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/pkl', {
        machineCode,
        shiftLogId,
        coilNo,
        widthMm: Number(prefill.widthMm ?? 0),
        thkMm: Number(prefill.thicknessMm ?? 0),
        weightMt: Number(prefill.weightMt ?? 0),
        lineSpeedMpm: lineSpeed === '' ? undefined : Number(lineSpeed),
        heatNo,
        source,
      }, coilNo);
      onSubmitted?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <p className="text-sm">{coilNo} · {String(prefill.gradeCode ?? '')}</p>
      <div className="grid grid-cols-2 gap-3">
        <ReadOnly label="Width mm" value={Number(prefill.widthMm ?? 0)} />
        <ReadOnly label="Thk mm" value={Number(prefill.thicknessMm ?? 0)} />
        <ReadOnly label="Weight MT" value={Number(prefill.weightMt ?? 0)} />
        <ZInput label="Line Speed mpm" type="number" value={lineSpeed} onChange={(e) => setLineSpeed(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="Heat No" value={heatNo} onChange={(e) => setHeatNo(e.target.value)} />
        <ZInput label="Source" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      <ZButton type="submit" disabled={submitting}>Submit PKL</ZButton>
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
