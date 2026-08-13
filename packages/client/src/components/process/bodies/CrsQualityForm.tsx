import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { crsMassBalanceWarn, crsWidthCombinationWarn } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture, useProcessStore } from '../../../store/processStore';
import { apiClient } from '../../../lib/apiClient';
import type { BodyProps } from '../../../lib/processConfig';

const SLOTS = ['A', 'B', 'C', 'D', 'E'] as const;

interface CrsLine {
  slot: (typeof SLOTS)[number];
  childCoilNo: string;
  slitNo: string;
  finishWidthMm?: number;
  noOfSlit: number;
  actualWidthMm?: number;
  actualThkFrontMm?: number;
  actualThkRearMm?: number;
  outputWtMt?: number;
  scrapMt?: number;
  rejectionOdMt?: number;
  rejectionIdMt?: number;
  holdFlag: boolean;
  forCtlFlag: boolean;
  routeCode: 'LE' | 'PKG';
  camberWaviness: string;
  raUm?: number;
  rzUm?: number;
  sapBatchNumber?: string;
}

export function CrsQualityForm({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const [inputWtMt, setInputWtMt] = useState(Number(prefill.weightMt ?? 0));
  const [inputWidthMm, setInputWidthMm] = useState(Number(prefill.widthMm ?? 0));
  const [hardnessVpn, setHardnessVpn] = useState<number | ''>('');
  const [uts, setUts] = useState<number | ''>('');
  const [elongation, setElongation] = useState<number | ''>('');
  const [specVersionId, setSpecVersionId] = useState<number | undefined>();
  const [finWidthTol, setFinWidthTol] = useState(0);
  const [lines, setLines] = useState<CrsLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // ponytail: slot cards buffer their own drafts and lift on blur; this tracks
  // any not-yet-blurred edits so submit can force-flush them (Android Save may not blur first).
  const pendingLinesRef = useRef<Map<string, CrsLine>>(new Map());

  useEffect(() => {
    if (!coilNo) return;
    let cancelled = false;
    const q = new URLSearchParams({ process: 'CRS', by: 'coil', coilNo, mode: 'snapshot' });
    type SpecRow = {
      code: string;
      min?: number | null;
      max?: number | null;
      target?: number | null;
      tolerance?: number | null;
      versionId: number;
    };
    void apiClient
      .get<SpecRow[]>(`/quality/fetch?${q}`)
      .then((rows) => {
        if (cancelled || !rows?.length) return;
        setSpecVersionId(rows[0]?.versionId);
        const fin = rows.find((r) => r.code === 'FIN_WIDTH_TOL' || r.code === 'FIN_WIDTH');
        if (fin?.max != null && fin?.min != null) setFinWidthTol(Math.abs(Number(fin.max) - Number(fin.min)) / 2);
        else if (fin?.tolerance != null) setFinWidthTol(Number(fin.tolerance));
        const hard = rows.find((r) => r.code === 'HARDNESS');
        if (hard?.target != null) setHardnessVpn(Number(hard.target));
        const u = rows.find((r) => r.code === 'UTS');
        if (u?.target != null) setUts(Number(u.target));
        const el = rows.find((r) => r.code === 'ELONGATION');
        if (el?.target != null) setElongation(Number(el.target));
      })
      .catch(() => { /* missing spec ⇒ NOT_EVALUATED */ });
    return () => { cancelled = true; };
  }, [coilNo]);

  // Prefill order-lines from queue card metadata when present on prefill
  useEffect(() => {
    const orderLines = (prefill as { orderLines?: Array<{ widthMm?: number; batchNumber?: string; routeRaw?: string }> }).orderLines;
    if (!orderLines?.length || lines.length > 0) return;
    setLines(orderLines.slice(0, SLOTS.length).map((ol, i) => {
      const slot = SLOTS[i];
      const route = (ol.routeRaw ?? '').toUpperCase();
      const forCtl = /C\s*LE|CLE|-LE\b|LE-PKG/.test(route) && !/CZ/.test(route.replace(/CLE/g, ''));
      const tailCle = route.includes('CLE') || /C.*LE/.test(route);
      return {
        slot,
        childCoilNo: `${coilNo}-${slot}`,
        slitNo: '',
        finishWidthMm: ol.widthMm,
        noOfSlit: 1,
        holdFlag: false,
        forCtlFlag: forCtl || tailCle,
        routeCode: (forCtl || tailCle) ? 'LE' as const : 'PKG' as const,
        camberWaviness: '',
        sapBatchNumber: ol.batchNumber,
      };
    }));
  }, [coilNo, prefill, lines.length]);

  const passOutput = useMemo(() => lines.reduce((s, l) => s + (l.outputWtMt ?? 0), 0), [lines]);
  const passScrap = useMemo(() => lines.reduce((s, l) => s + (l.scrapMt ?? 0), 0), [lines]);
  const passReject = useMemo(
    () => lines.reduce((s, l) => s + (l.rejectionOdMt ?? 0) + (l.rejectionIdMt ?? 0), 0),
    [lines],
  );
  const massWarn = crsMassBalanceWarn(inputWtMt, lines.map((l) => l.outputWtMt ?? 0), passScrap, passReject);
  const widthCheck = crsWidthCombinationWarn(
    inputWidthMm,
    lines.map((l) => ({ finishWidthMm: l.finishWidthMm, noOfSlit: l.noOfSlit })),
    0,
    finWidthTol,
  );

  function addLine(slot: (typeof SLOTS)[number]) {
    if (lines.some((l) => l.slot === slot)) return;
    setLines([...lines, {
      slot, childCoilNo: `${coilNo}-${slot}`, slitNo: '', noOfSlit: 1,
      holdFlag: false, forCtlFlag: false, routeCode: 'PKG', camberWaviness: '',
    }]);
  }

  const patch = useCallback((slot: (typeof SLOTS)[number], p: Partial<CrsLine>) => {
    setLines((prev) => prev.map((l) => {
      if (l.slot !== slot) return l;
      const next = { ...l, ...p, childCoilNo: `${coilNo}-${slot}` };
      if (p.forCtlFlag != null) next.routeCode = p.forCtlFlag ? 'LE' : 'PKG';
      if (p.routeCode != null) next.forCtlFlag = p.routeCode === 'LE';
      return next;
    }));
  }, [coilNo]);

  // MANDATORY: force-flush any unblurred slot-card drafts before reading `lines`.
  function flushPendingLines(): CrsLine[] {
    if (pendingLinesRef.current.size === 0) return lines;
    const merged = lines.map((l) => pendingLinesRef.current.get(l.slot) ?? l);
    pendingLinesRef.current.clear();
    setLines(merged);
    return merged;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const flushedLines = flushPendingLines();
    setError(null);
    if (flushedLines.length === 0) {
      setError('Add at least one slit line');
      useProcessStore.getState().settleEndCaptureError('Add at least one slit line');
      return;
    }
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/crs', {
        machineCode,
        shiftLogId,
        coilNo,
        coilWidthMm: inputWidthMm,
        nominalThkMm: Number(prefill.thicknessMm ?? 0),
        hardnessVpn: hardnessVpn === '' ? undefined : Number(hardnessVpn),
        utsNmm2: uts === '' ? undefined : Number(uts),
        elongationPct: elongation === '' ? undefined : Number(elongation),
        inputWtMt,
        outputWtMt: flushedLines.reduce((s, l) => s + (l.outputWtMt ?? 0), 0),
        scrapMt: flushedLines.reduce((s, l) => s + (l.scrapMt ?? 0), 0),
        rejectionOdMt: flushedLines.reduce((s, l) => s + (l.rejectionOdMt ?? 0), 0),
        rejectionIdMt: flushedLines.reduce((s, l) => s + (l.rejectionIdMt ?? 0), 0),
        forCtlMt: flushedLines.filter((l) => l.forCtlFlag && !l.holdFlag).reduce((s, l) => s + (l.outputWtMt ?? 0), 0),
        holdMt: flushedLines.filter((l) => l.holdFlag).reduce((s, l) => s + (l.outputWtMt ?? 0), 0),
        specVersionId,
        slitSlots: flushedLines.map((l) => ({
          slot: l.slot,
          widthMm: l.finishWidthMm ?? l.actualWidthMm,
          finishWidthMm: l.finishWidthMm,
          noOfSlit: l.noOfSlit,
          childCoilNo: l.childCoilNo,
          slitNo: l.slitNo || undefined,
          actualWidthMm: l.actualWidthMm,
          actualThkFrontMm: l.actualThkFrontMm,
          actualThkRearMm: l.actualThkRearMm,
          outputWtMt: l.outputWtMt,
          scrapMt: l.scrapMt,
          rejectionOdMt: l.rejectionOdMt,
          rejectionIdMt: l.rejectionIdMt,
          holdFlag: l.holdFlag,
          forCtlFlag: l.forCtlFlag,
          routeCode: l.routeCode,
          camberWaviness: l.camberWaviness || undefined,
          raUm: l.raUm,
          rzUm: l.rzUm,
          sapBatchNumber: l.sapBatchNumber,
        })),
      }, coilNo);
      onSubmitted?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submit failed';
      setError(msg);
      useProcessStore.getState().settleEndCaptureError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <p className="text-sm font-medium">CRS Pass · {coilNo}</p>
      {specVersionId != null && (
        <p className="text-[10px] text-muted-foreground">Spec version #{specVersionId} (snapshot on submit)</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <ReadOnly label="Grade" value={String(prefill.gradeCode ?? '—')} />
        <ZInput label="Input Width mm" type="number" value={inputWidthMm} onChange={(e) => setInputWidthMm(Number(e.target.value))} />
        <ZInput label="Input WT MT" type="number" value={inputWtMt} onChange={(e) => setInputWtMt(Number(e.target.value))} />
        <ZInput label="Hardness VPN" type="number" value={hardnessVpn} onChange={(e) => setHardnessVpn(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="UTS N/mm²" type="number" value={uts} onChange={(e) => setUts(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="Elongation %" type="number" value={elongation} onChange={(e) => setElongation(e.target.value === '' ? '' : Number(e.target.value))} />
        <ReadOnly label="Pass Output MT" value={passOutput.toFixed(3)} />
        <ReadOnly label="Packed Width mm" value={widthCheck.packedMm.toFixed(1)} />
      </div>

      <div className="flex gap-2 flex-wrap">
        {SLOTS.map((label) => (
          <ZButton key={label} type="button" variant="secondary" onClick={() => addLine(label)} disabled={lines.some((l) => l.slot === label)}>
            + Line {label}
          </ZButton>
        ))}
      </div>

      {!widthCheck.ok && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{widthCheck.message}</p>
      )}
      {massWarn && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Mass-balance warning: Σ line output + scrap + rejection ≠ input weight.
        </p>
      )}

      {lines.map((line) => (
        <CrsSlotCard key={line.slot} line={line} onCommit={patch} pendingRef={pendingLinesRef} />
      ))}

      {error && <p className="text-destructive text-sm">{error}</p>}
      <ZButton type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit CRS'}</ZButton>
    </form>
  );
}

/**
 * One slit line's editable fields. Keeps its own draft so typing in this card
 * never touches parent state (and therefore never re-renders sibling cards);
 * each field lifts to the parent via `onCommit` on blur. Checkboxes commit
 * immediately since they're a single discrete action, not typed text.
 */
const CrsSlotCard = memo(function CrsSlotCard({
  line,
  onCommit,
  pendingRef,
}: {
  line: CrsLine;
  onCommit: (slot: CrsLine['slot'], p: Partial<CrsLine>) => void;
  pendingRef: React.MutableRefObject<Map<string, CrsLine>>;
}) {
  const [draft, setDraft] = useState(line);
  useEffect(() => setDraft(line), [line]);

  function setField<K extends keyof CrsLine>(key: K, value: CrsLine[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      pendingRef.current.set(line.slot, next);
      return next;
    });
  }

  function commitField<K extends keyof CrsLine>(key: K) {
    pendingRef.current.delete(line.slot);
    if (draft[key] !== line[key]) onCommit(line.slot, { [key]: draft[key] } as Partial<CrsLine>);
  }

  function commitCheckbox<K extends keyof CrsLine>(key: K, value: CrsLine[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    onCommit(line.slot, { [key]: value } as Partial<CrsLine>);
  }

  return (
    <div className="border rounded-xl p-3 grid grid-cols-2 gap-2">
      <ReadOnly label="Line" value={line.slot} />
      <ReadOnly label="Child Coil" value={line.childCoilNo} />
      <ZInput label="Slit No" value={draft.slitNo} onChange={(e) => setField('slitNo', e.target.value)} onBlur={() => commitField('slitNo')} />
      <ZInput label="SAP Batch" value={draft.sapBatchNumber ?? ''} onChange={(e) => setField('sapBatchNumber', e.target.value)} onBlur={() => commitField('sapBatchNumber')} />
      <ZInput label="Finish Width mm" type="number" value={draft.finishWidthMm ?? ''} onChange={(e) => setField('finishWidthMm', Number(e.target.value))} onBlur={() => commitField('finishWidthMm')} />
      <ZInput label="No. of Slit" type="number" value={draft.noOfSlit} onChange={(e) => setField('noOfSlit', Math.max(1, Number(e.target.value) || 1))} onBlur={() => commitField('noOfSlit')} />
      <ZInput label="Actual Width mm" type="number" value={draft.actualWidthMm ?? ''} onChange={(e) => setField('actualWidthMm', Number(e.target.value))} onBlur={() => commitField('actualWidthMm')} />
      <ZInput label="Front Thk mm" type="number" value={draft.actualThkFrontMm ?? ''} onChange={(e) => setField('actualThkFrontMm', Number(e.target.value))} onBlur={() => commitField('actualThkFrontMm')} />
      <ZInput label="Rear Thk mm" type="number" value={draft.actualThkRearMm ?? ''} onChange={(e) => setField('actualThkRearMm', Number(e.target.value))} onBlur={() => commitField('actualThkRearMm')} />
      <ZInput label="Output WT MT" type="number" value={draft.outputWtMt ?? ''} onChange={(e) => setField('outputWtMt', Number(e.target.value))} onBlur={() => commitField('outputWtMt')} />
      <ZInput label="Scrap MT" type="number" value={draft.scrapMt ?? ''} onChange={(e) => setField('scrapMt', Number(e.target.value))} onBlur={() => commitField('scrapMt')} />
      <ZInput label="Reject OD MT" type="number" value={draft.rejectionOdMt ?? ''} onChange={(e) => setField('rejectionOdMt', Number(e.target.value))} onBlur={() => commitField('rejectionOdMt')} />
      <ZInput label="Reject ID MT" type="number" value={draft.rejectionIdMt ?? ''} onChange={(e) => setField('rejectionIdMt', Number(e.target.value))} onBlur={() => commitField('rejectionIdMt')} />
      <ZInput label="Camber / Waviness" value={draft.camberWaviness} onChange={(e) => setField('camberWaviness', e.target.value)} onBlur={() => commitField('camberWaviness')} />
      <ZInput label="Ra µm" type="number" value={draft.raUm ?? ''} onChange={(e) => setField('raUm', Number(e.target.value))} onBlur={() => commitField('raUm')} />
      <ZInput label="Rz µm" type="number" value={draft.rzUm ?? ''} onChange={(e) => setField('rzUm', Number(e.target.value))} onBlur={() => commitField('rzUm')} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.forCtlFlag} onChange={(e) => commitCheckbox('forCtlFlag', e.target.checked)} />
        For-CTL (→ LE)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.holdFlag} onChange={(e) => commitCheckbox('holdFlag', e.target.checked)} />
        HOLD (no advance)
      </label>
    </div>
  );
});

function ReadOnly({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-secondary/40 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
