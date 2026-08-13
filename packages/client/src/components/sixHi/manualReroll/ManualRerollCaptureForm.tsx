import type { SixHiDestination, SixHiRollingPass } from '@m1/shared-validation';
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { FieldWrapper } from '../../forms/FieldWrapper';
import { ActualWeightCaptureField } from '../ActualWeightCaptureField';
import { PassTracker } from '../PassTracker';
import { ThicknessSpecs } from '../ThicknessSpecs';
import type { ManualRerollPass, ManualRerollSession } from '../../../services/manualRerollService';
import { saveManualRerollCapture } from '../../../services/manualRerollService';

export type ManualRerollOrderSummary = {
  batchNumber: string;
  coilNo?: string;
  customer?: string;
  grade?: string | null;
  widthMm?: number | null;
  thkMm?: number | null;
  weightMt?: number | null;
  slitId?: string | null;
  rollFinish?: string | null;
};

export type ManualRerollConsoleContext = {
  coilNo?: string;
  customer?: string;
  grade?: string | null;
  widthMm?: number | null;
  thkMm?: number | null;
  inputThkMm?: number | null;
  weightMt?: number | null;
  slitId?: string | null;
  rollFinish?: string | null;
  combinedCount?: number;
  combinedTargetMt?: number;
  /** Running order(s) in this console — primary first. */
  orders?: ManualRerollOrderSummary[];
};

type OcrFields = {
  actualWeightSource?: string | null;
  actualWeightPhotoHash?: string | null;
  ocrConfidence?: number | null;
  ocrRawText?: string | null;
};

type DecimalField = 'etr' | 'dtr';

function toDraft(value?: number | null): string {
  return value == null ? '' : String(value);
}

function isDecimalDraft(value: string): boolean {
  return /^(\d+(\.\d*)?|\.\d*)?$/.test(value.trim());
}

function parseDecimalDraft(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function seedPasses(session: ManualRerollSession, seedThkMm?: number | null): ManualRerollPass[] {
  if (session.passes && session.passes.length > 0) return session.passes;
  if (seedThkMm != null && Number.isFinite(seedThkMm) && seedThkMm > 0) {
    return [{ passNo: 1, thicknessMm: seedThkMm }];
  }
  return [];
}

interface ManualRerollCaptureFormProps {
  session: ManualRerollSession;
  machine: string;
  context?: ManualRerollConsoleContext | null;
  locked?: boolean;
  onSaved?: (session: ManualRerollSession) => void;
}

/** Weight + destination/ETR/DTR + passes — rolling compact layout, session-persisted. */
export function ManualRerollCaptureForm({
  session,
  machine,
  context,
  locked,
  onSaved,
}: ManualRerollCaptureFormProps) {
  const isCombined = !!context?.combinedCount && context.combinedCount > 1;
  const targetThk = session.targetThkMm ?? context?.thkMm ?? null;
  const inputThk = session.inputThkMm ?? context?.inputThkMm ?? null;
  const ppcDest = (session.destination as SixHiDestination | null) ?? 'ANNEALING';

  const [weightDraft, setWeightDraft] = useState(() => toDraft(session.actualWeightMt));
  const [passes, setPasses] = useState<ManualRerollPass[]>(() => seedPasses(session, targetThk));
  const [destination, setDestination] = useState<SixHiDestination>(ppcDest);
  const [overrideDest, setOverrideDest] = useState(session.destinationOverride === true);
  const [drafts, setDrafts] = useState({
    etr: toDraft(session.etr),
    dtr: toDraft(session.dtr),
  });
  const [etr, setEtr] = useState<number | undefined>(session.etr ?? undefined);
  const [dtr, setDtr] = useState<number | undefined>(session.dtr ?? undefined);
  const [ocr, setOcr] = useState<OcrFields>({
    actualWeightSource: session.actualWeightSource,
    actualWeightPhotoHash: session.actualWeightPhotoHash,
    ocrConfidence: session.ocrConfidence,
    ocrRawText: session.ocrRawText,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const readOnly = locked
    || session.status === 'COMPLETED'
    || session.status === 'CANCELLED';

  const effectiveDest = overrideDest ? destination : ppcDest;

  const weightLabel = isCombined
    ? 'Combined Actual Weight (Metric Tons)'
    : 'Actual Weight (Metric Tons)';
  const weightHint = isCombined && context?.combinedTargetMt != null ? (
    <p className="text-xs text-muted-foreground mt-1">
      Combined target: {context.combinedTargetMt} MT across {context.combinedCount} orders
    </p>
  ) : null;

  const saveLabel = isCombined
    ? `Save Production Data (${context!.combinedCount} orders)`
    : 'Save Production Data';

  const updateWeightDraft = (raw: string) => {
    if (!isDecimalDraft(raw)) return;
    setWeightDraft(raw);
  };

  const commitWeightDraft = (overrideValue?: number) => {
    const parsed = overrideValue !== undefined ? overrideValue : parseDecimalDraft(weightDraft);
    setWeightDraft(toDraft(parsed));
  };

  const updateDecimalDraft = (field: DecimalField, raw: string) => {
    if (!isDecimalDraft(raw)) return;
    setDrafts((prev) => ({ ...prev, [field]: raw }));
  };

  const commitDecimalDraft = (field: DecimalField) => {
    const parsed = parseDecimalDraft(drafts[field]);
    setDrafts((prev) => ({ ...prev, [field]: toDraft(parsed) }));
    if (field === 'etr') setEtr(parsed);
    else setDtr(parsed);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const weight = parseDecimalDraft(weightDraft);
      const next = await saveManualRerollCapture(session.sessionId, machine, {
        actualWeightMt: weight ?? null,
        actualWeightSource: ocr.actualWeightSource ?? (weight != null ? 'manual' : null),
        actualWeightPhotoHash: ocr.actualWeightPhotoHash ?? null,
        ocrConfidence: ocr.ocrConfidence ?? null,
        ocrRawText: ocr.ocrRawText ?? null,
        destination: effectiveDest,
        destinationOverride: overrideDest,
        etr: etr ?? null,
        dtr: dtr ?? null,
        inputThkMm: inputThk,
        targetThkMm: targetThk,
        passes,
      });
      setSaved(true);
      onSaved?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const specsOrder = {
    inputThkMm: inputThk ?? 0,
    targetThkMm: targetThk ?? 0,
    minThkTolMm: undefined as number | undefined,
    maxThkTolMm: undefined as number | undefined,
    raMinUm: undefined as number | undefined,
    raMaxUm: undefined as number | undefined,
  };

  return (
    <div className="flex flex-col">
      <div className="p-3 space-y-3">
        <div className="bg-white border border-border rounded-xl p-3 space-y-2">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <h3 className="text-base font-bold text-foreground whitespace-nowrap">
              Production · Re-roll
            </h3>
            <div className="w-full md:w-[65%] lg:w-[60%]">
              <ThicknessSpecs order={specsOrder} compact />
            </div>
          </div>

          <ActualWeightCaptureField
            label={weightLabel}
            value={weightDraft}
            onDraftChange={updateWeightDraft}
            onDraftCommit={() => commitWeightDraft()}
            formLocked={!!readOnly}
            ocr={{
              actualWeightSource: ocr.actualWeightSource as 'manual' | 'ocr' | undefined,
              actualWeightPhotoHash: ocr.actualWeightPhotoHash ?? undefined,
              ocrConfidence: ocr.ocrConfidence ?? undefined,
              ocrRawText: ocr.ocrRawText ?? undefined,
            }}
            onOcrChange={(next) => setOcr((prev) => ({ ...prev, ...next }))}
            onWeightConfirmed={(v) => commitWeightDraft(v)}
            prominent
            inputClassName="min-h-14 text-xl"
            hint={weightHint}
            className="!mb-0"
          />

          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-medium text-muted-foreground">
              Destination: {effectiveDest === 'REWINDING' ? 'Rewinding' : 'Annealing'}
            </span>
            {!overrideDest ? (
              <button
                type="button"
                className="text-sm font-bold text-foreground underline"
                onClick={() => setOverrideDest(true)}
                disabled={readOnly}
              >
                Override
              </button>
            ) : (
              <div className="flex gap-1">
                {(['ANNEALING', 'REWINDING'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDestination(d)}
                    disabled={readOnly}
                    className={[
                      'min-h-11 px-3 rounded-lg border text-sm font-bold',
                      destination === d ? 'bg-primary text-white' : 'border-border',
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
                <ZInput
                  type="number"
                  inputMode="decimal"
                  enterKeyHint="next"
                  value={drafts.etr}
                  onChange={(e) => updateDecimalDraft('etr', e.target.value)}
                  onBlur={() => commitDecimalDraft('etr')}
                  className="min-h-11 text-base"
                  disabled={readOnly}
                />
              </FieldWrapper>
              <FieldWrapper label="Delivery Tension">
                <ZInput
                  type="number"
                  inputMode="decimal"
                  enterKeyHint="next"
                  value={drafts.dtr}
                  onChange={(e) => updateDecimalDraft('dtr', e.target.value)}
                  onBlur={() => commitDecimalDraft('dtr')}
                  className="min-h-11 text-base"
                  disabled={readOnly}
                />
              </FieldWrapper>
            </div>
          )}
        </div>

        <div className="bg-white border border-border rounded-xl p-3">
          <PassTracker
            passes={passes as SixHiRollingPass[]}
            onChange={(next) => setPasses(next.map((p) => ({ passNo: p.passNo, thicknessMm: p.thicknessMm })))}
            disabled={readOnly}
            compact
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}
        {saved && !error && (
          <div className="px-3 py-2 bg-green-500/10 border border-green-500/20 text-green-700 text-sm rounded-xl font-semibold">
            Production data saved successfully.
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 border-t border-border bg-card px-3 py-2 z-10">
          <ZButton
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => void save()}
            disabled={busy}
            className="min-h-14 text-base font-bold"
          >
            {busy ? 'Saving…' : saveLabel}
          </ZButton>
        </div>
      )}
    </div>
  );
}
