import { useEffect, useState } from 'react';
import type { SixHiOrderDetail, SixHiSkinPassData } from '@m1/shared-validation';
import { useSixHiStore } from '../../store/sixHiStore';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { ActualWeightCaptureField } from './ActualWeightCaptureField';
import { ThicknessSpecs } from './ThicknessSpecs';

type SkinPassMetric = 'ANN_HARD' | 'RW_TENSION';
type SkinPassDecimalField =
  | 'outputThkMm'
  | 'actualWeightMt'
  | 'annHard'
  | 'loadMinT'
  | 'loadMaxT'
  | 'stretchPct';

interface SkinPassWorkspaceProps {
  order: SixHiOrderDetail;
  onSave: (data: SixHiSkinPassData) => Promise<void>;
  busy?: boolean;
  compact?: boolean;
  combinedOrderCount?: number;
  combinedTargetMt?: number;
  combinedActualMt?: number;
  readOnly?: boolean;
}

function initialMetricChoice(skinPass?: SixHiSkinPassData): SkinPassMetric {
  if (skinPass?.rwTension1 != null || skinPass?.rwTension2 != null) return 'RW_TENSION';
  return 'ANN_HARD';
}

function formatRwTension(t1?: number, t2?: number): string {
  if (t1 == null && t2 == null) return '';
  if (t2 == null) return String(t1 ?? '');
  return `${t1 ?? ''}/${t2 ?? ''}`;
}

function parseRwTension(value: string): Pick<SixHiSkinPassData, 'rwTension1' | 'rwTension2'> {
  const trimmed = value.trim();
  if (!trimmed) return { rwTension1: undefined, rwTension2: undefined };

  const parts = trimmed.split('/').map((s) => s.trim());
  if (parts.length === 1) {
    const n = Number(parts[0]);
    return Number.isFinite(n) ? { rwTension1: n, rwTension2: undefined } : {};
  }

  const t1 = parts[0] ? Number(parts[0]) : undefined;
  const t2 = parts[1] ? Number(parts[1]) : undefined;
  return {
    rwTension1: t1 != null && Number.isFinite(t1) ? t1 : undefined,
    rwTension2: t2 != null && Number.isFinite(t2) ? t2 : undefined,
  };
}

function prepareSaveData(data: SixHiSkinPassData, metric: SkinPassMetric): SixHiSkinPassData {
  if (metric === 'ANN_HARD') {
    return { ...data, rwTension1: undefined, rwTension2: undefined };
  }
  return { ...data, annHard: undefined };
}

function toDraft(value?: number): string {
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

/** Compact segmented control — intentionally shorter than production inputs. */
function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  locked,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (next: T) => void;
  locked: boolean;
}) {
  return (
    <div
      className="inline-flex w-full sm:w-auto max-w-full rounded-md border border-border bg-muted/40 p-0.5 gap-0.5"
      role="group"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          disabled={locked}
          className={[
            'flex-1 sm:flex-none min-h-8 h-8 px-3 rounded text-[11px] font-semibold tracking-wide whitespace-nowrap',
            'disabled:opacity-50 touch-manipulation',
            value === opt.id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-transparent text-foreground hover:bg-background/80',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const METRIC_OPTIONS: Array<{ id: SkinPassMetric; label: string }> = [
  { id: 'ANN_HARD', label: 'Ann Hard' },
  { id: 'RW_TENSION', label: 'SP Tension' },
];

const MODE_OPTIONS: Array<{ id: 'LOAD' | 'STRETCH'; label: string }> = [
  { id: 'LOAD', label: 'Load Mode' },
  { id: 'STRETCH', label: 'Stretch Mode' },
];

function skinPassHydrateKey(order: SixHiOrderDetail, combinedActualMt?: number): string {
  const s = order.skinPass;
  if (!s) return `${order.batchNumber}|none|${combinedActualMt ?? ''}`;
  return [
    order.batchNumber,
    s.outputThkMm ?? '',
    s.actualWeightMt ?? '',
    s.annHard ?? '',
    s.rwTension1 ?? '',
    s.rwTension2 ?? '',
    s.loadMinT ?? '',
    s.loadMaxT ?? '',
    s.stretchPct ?? '',
    s.operatingMode ?? '',
    combinedActualMt ?? '',
  ].join('|');
}

function draftsFromSkinPass(
  order: SixHiOrderDetail,
  skinPass: SixHiSkinPassData,
  isCombined: boolean,
  combinedActualMt?: number,
): Record<SkinPassDecimalField, string> {
  return {
    outputThkMm: toDraft(skinPass.outputThkMm),
    actualWeightMt: toDraft(
      isCombined ? combinedActualMt ?? skinPass.actualWeightMt : skinPass.actualWeightMt,
    ),
    annHard: toDraft(skinPass.annHard),
    loadMinT: toDraft(skinPass.loadMinT),
    loadMaxT: toDraft(skinPass.loadMaxT),
    stretchPct: toDraft(skinPass.stretchPct),
  };
}

export function SharedSkinPassForm({
  order,
  onSave,
  busy,
  compact,
  combinedOrderCount,
  combinedTargetMt,
  combinedActualMt,
  readOnly,
}: SkinPassWorkspaceProps) {
  const isCombined = !!combinedOrderCount && combinedOrderCount > 1;
  const [data, setData] = useState<SixHiSkinPassData>(order.skinPass ?? {});
  const [drafts, setDrafts] = useState<Record<SkinPassDecimalField, string>>({
    outputThkMm: toDraft(order.skinPass?.outputThkMm),
    actualWeightMt: toDraft(
      isCombined
        ? combinedActualMt ?? order.skinPass?.actualWeightMt
        : order.skinPass?.actualWeightMt,
    ),
    annHard: toDraft(order.skinPass?.annHard),
    loadMinT: toDraft(order.skinPass?.loadMinT),
    loadMaxT: toDraft(order.skinPass?.loadMaxT),
    stretchPct: toDraft(order.skinPass?.stretchPct),
  });
  const [metric, setMetric] = useState<SkinPassMetric>(() => initialMetricChoice(order.skinPass));
  const [rwTensionInput, setRwTensionInput] = useState(() =>
    formatRwTension(order.skinPass?.rwTension1, order.skinPass?.rwTension2),
  );
  const [hydrateKey, setHydrateKey] = useState(() => skinPassHydrateKey(order, combinedActualMt));
  const locked = readOnly || order.status === 'COMPLETED';

  useEffect(() => {
    const nextKey = skinPassHydrateKey(order, combinedActualMt);
    if (nextKey === hydrateKey) return;
    const skinPass = order.skinPass ?? {};
    setHydrateKey(nextKey);
    setData(skinPass);
    setDrafts(draftsFromSkinPass(order, skinPass, isCombined, combinedActualMt));
    setMetric(initialMetricChoice(order.skinPass));
    setRwTensionInput(formatRwTension(order.skinPass?.rwTension1, order.skinPass?.rwTension2));
  }, [order, combinedActualMt, hydrateKey, isCombined]);

  const switchMetric = (next: SkinPassMetric) => {
    setMetric(next);
    if (next === 'ANN_HARD') {
      setRwTensionInput('');
      setData((prev) => ({ ...prev, rwTension1: undefined, rwTension2: undefined }));
    } else {
      setDrafts((prev) => ({ ...prev, annHard: '' }));
      setData((prev) => ({ ...prev, annHard: undefined }));
    }
  };

  const updateRwTensionInput = (value: string) => {
    setRwTensionInput(value);
    setData((prev) => ({ ...prev, ...parseRwTension(value) }));
  };

  const updateDecimalDraft = (field: SkinPassDecimalField, raw: string) => {
    if (!isDecimalDraft(raw)) return;
    setDrafts((prev) => ({ ...prev, [field]: raw }));

    if (raw.trim() && !raw.endsWith('.')) {
      const parsed = parseDecimalDraft(raw);
      setData((prev) => ({ ...prev, [field]: parsed }));
      return;
    }

    if (!raw.trim() || raw === '.') {
      setData((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const commitDecimalDraft = (field: SkinPassDecimalField, overrideValue?: number) => {
    const parsed = overrideValue !== undefined ? overrideValue : parseDecimalDraft(drafts[field]);
    setDrafts((prev) => ({ ...prev, [field]: toDraft(parsed) }));
    setData((prev) => ({ ...prev, [field]: parsed }));
    if (isCombined && field === 'actualWeightMt' && parsed != null) {
      useSixHiStore.getState().setCombinedActualMtIntent(parsed);
    }
  };

  const saveLabel = combinedOrderCount && combinedOrderCount > 1
    ? `Save Production Data (${combinedOrderCount} orders)`
    : 'Save Production Data';

  const save = () => {
    const weight = parseDecimalDraft(drafts.actualWeightMt);
    if (isCombined && weight != null) {
      useSixHiStore.getState().setCombinedActualMtIntent(weight);
    }
    const payload =
      metric === 'RW_TENSION'
        ? { ...data, ...parseRwTension(rwTensionInput) }
        : data;
    const withWeight = isCombined && weight != null
      ? { ...payload, actualWeightMt: weight }
      : payload;
    onSave(prepareSaveData(withWeight, metric));
  };

  const weightLabel = isCombined ? 'Combined Actual Weight (Metric Tons)' : 'Actual Weight (Metric Tons)';
  const weightHint = isCombined && combinedTargetMt != null ? (
    <p className="text-xs text-muted-foreground mt-1">
      Combined target: {combinedTargetMt} MT across {combinedOrderCount} orders
    </p>
  ) : null;

  const weightField = (
    <ActualWeightCaptureField
      label={weightLabel}
      value={drafts.actualWeightMt}
      onDraftChange={(raw) => updateDecimalDraft('actualWeightMt', raw)}
      onDraftCommit={() => commitDecimalDraft('actualWeightMt')}
      formLocked={locked}
      ocr={{
        actualWeightSource: data.actualWeightSource,
        actualWeightPhotoHash: data.actualWeightPhotoHash,
        ocrConfidence: data.ocrConfidence,
        ocrRawText: data.ocrRawText,
      }}
      onOcrChange={(next) => setData((prev) => ({ ...prev, ...next }))}
      onWeightConfirmed={(v) => commitDecimalDraft('actualWeightMt', v)}
      ocrMinConfidence={order.ocrMinConfidence}
      prominent={!!compact}
      inputClassName={compact ? 'min-h-12 text-lg' : 'min-h-14 text-lg'}
      hint={weightHint}
      className="!mb-0"
    />
  );

  const operatingMode = data.operatingMode ?? 'LOAD';

  if (compact) {
    return (
      <div className="flex flex-col">
        <div className="p-3">
          <div className="bg-white border border-border rounded-xl p-3 space-y-3">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <h3 className="text-base font-bold text-foreground whitespace-nowrap">Skin Pass</h3>
              <div className="w-full md:w-[65%] lg:w-[60%]">
                <ThicknessSpecs order={order} compact />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
              <FieldWrapper label="Output Thickness (mm)" prominent className="!mb-0">
                <ZInput
                  type="number"
                  inputMode="decimal"
                  enterKeyHint="next"
                  autoComplete="off"
                  value={drafts.outputThkMm}
                  onChange={(e) => updateDecimalDraft('outputThkMm', e.target.value)}
                  onBlur={() => commitDecimalDraft('outputThkMm')}
                  className="min-h-12 text-lg"
                  disabled={locked}
                />
              </FieldWrapper>
              <div className="min-w-0">{weightField}</div>
            </div>

            <div className="space-y-1.5">
              <SegmentedToggle
                value={metric}
                options={METRIC_OPTIONS}
                onChange={switchMetric}
                locked={locked}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                {metric === 'ANN_HARD' ? (
                  <FieldWrapper label="Annealing Hardness" prominent className="!mb-0">
                    <ZInput
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="next"
                      value={drafts.annHard}
                      onChange={(e) => updateDecimalDraft('annHard', e.target.value)}
                      onBlur={() => commitDecimalDraft('annHard')}
                      className="min-h-12 text-lg"
                      disabled={locked}
                    />
                  </FieldWrapper>
                ) : (
                  <FieldWrapper label="SP Tension" prominent className="!mb-0">
                    <ZInput
                      inputMode="text"
                      enterKeyHint="next"
                      placeholder="e.g. 1500/400"
                      value={rwTensionInput}
                      onChange={(e) => updateRwTensionInput(e.target.value)}
                      className="min-h-12 text-lg font-mono"
                      disabled={locked}
                    />
                  </FieldWrapper>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <SegmentedToggle
                value={operatingMode}
                options={MODE_OPTIONS}
                onChange={(m) => setData({ ...data, operatingMode: m })}
                locked={locked}
              />
              {operatingMode === 'LOAD' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                  <FieldWrapper label="Load Minimum (Tonnes)" prominent className="!mb-0">
                    <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={drafts.loadMinT} onChange={(e) => updateDecimalDraft('loadMinT', e.target.value)} onBlur={() => commitDecimalDraft('loadMinT')} className="min-h-12 text-lg" disabled={locked} />
                  </FieldWrapper>
                  <FieldWrapper label="Load Maximum (Tonnes)" prominent className="!mb-0">
                    <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={drafts.loadMaxT} onChange={(e) => updateDecimalDraft('loadMaxT', e.target.value)} onBlur={() => commitDecimalDraft('loadMaxT')} className="min-h-12 text-lg" disabled={locked} />
                  </FieldWrapper>
                </div>
              )}
              {operatingMode === 'STRETCH' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                  <FieldWrapper label="Stretch (%)" prominent className="!mb-0">
                    <ZInput type="number" inputMode="decimal" enterKeyHint="done" value={drafts.stretchPct} onChange={(e) => updateDecimalDraft('stretchPct', e.target.value)} onBlur={() => commitDecimalDraft('stretchPct')} className="min-h-12 text-lg" disabled={locked} />
                  </FieldWrapper>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-border bg-card px-3 py-2 z-10">
          {!readOnly && (
          <ZButton variant="primary" size="lg" fullWidth onClick={save} disabled={busy || locked} className="min-h-14 text-base font-bold">
            {saveLabel}
          </ZButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[#1E4D6B] text-white px-4 py-3">
        <h2 className="text-lg font-bold">Skin Pass Production</h2>
      </div>
      <div className="bg-white border border-border rounded-2xl p-4">
        <ThicknessSpecs order={order} />
      </div>
      <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3">
          <FieldWrapper label="Output Thickness (mm)" className="!mb-0">
            <ZInput type="number" inputMode="decimal" enterKeyHint="next" autoComplete="off" value={drafts.outputThkMm} onChange={(e) => updateDecimalDraft('outputThkMm', e.target.value)} onBlur={() => commitDecimalDraft('outputThkMm')} className="min-h-14 text-lg" disabled={locked} />
          </FieldWrapper>
          <div className="min-w-0">{weightField}</div>
        </div>
        <div className="space-y-2">
          <SegmentedToggle value={metric} options={METRIC_OPTIONS} onChange={switchMetric} locked={locked} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3">
            {metric === 'ANN_HARD' ? (
              <FieldWrapper label="Annealing Hardness" className="!mb-0">
                <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={drafts.annHard} onChange={(e) => updateDecimalDraft('annHard', e.target.value)} onBlur={() => commitDecimalDraft('annHard')} className="min-h-14 text-lg" disabled={locked} />
              </FieldWrapper>
            ) : (
              <FieldWrapper label="SP Tension" className="!mb-0">
                <ZInput
                  inputMode="text"
                  enterKeyHint="next"
                  placeholder="e.g. 1500/400"
                  value={rwTensionInput}
                  onChange={(e) => updateRwTensionInput(e.target.value)}
                  className="min-h-14 text-lg font-mono"
                  disabled={locked}
                />
              </FieldWrapper>
            )}
          </div>
        </div>
      </div>
      <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
        <SegmentedToggle
          value={operatingMode}
          options={MODE_OPTIONS}
          onChange={(m) => setData({ ...data, operatingMode: m })}
          locked={locked}
        />
        {operatingMode === 'LOAD' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldWrapper label="Load Minimum (Tonnes)" className="!mb-0"><ZInput type="number" inputMode="decimal" value={drafts.loadMinT} onChange={(e) => updateDecimalDraft('loadMinT', e.target.value)} onBlur={() => commitDecimalDraft('loadMinT')} className="min-h-14" disabled={locked} /></FieldWrapper>
            <FieldWrapper label="Load Maximum (Tonnes)" className="!mb-0"><ZInput type="number" inputMode="decimal" value={drafts.loadMaxT} onChange={(e) => updateDecimalDraft('loadMaxT', e.target.value)} onBlur={() => commitDecimalDraft('loadMaxT')} className="min-h-14" disabled={locked} /></FieldWrapper>
          </div>
        )}
        {operatingMode === 'STRETCH' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldWrapper label="Stretch (%)" className="!mb-0"><ZInput type="number" inputMode="decimal" value={drafts.stretchPct} onChange={(e) => updateDecimalDraft('stretchPct', e.target.value)} onBlur={() => commitDecimalDraft('stretchPct')} className="min-h-14" disabled={locked} /></FieldWrapper>
          </div>
        )}
      </div>
      {!readOnly && (
      <ZButton variant="primary" size="lg" fullWidth onClick={save} disabled={busy || locked} className="min-h-14">{saveLabel}</ZButton>
      )}
    </div>
  );
}
