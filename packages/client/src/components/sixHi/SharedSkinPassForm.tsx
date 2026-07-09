import { useState } from 'react';
import type { SixHiOrderDetail, SixHiSkinPassData } from '@m1/shared-validation';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';

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

function MetricToggle({
  metric,
  onChange,
  locked,
  compact,
}: {
  metric: SkinPassMetric;
  onChange: (m: SkinPassMetric) => void;
  locked: boolean;
  compact?: boolean;
}) {
  const btnClass = (m: SkinPassMetric) =>
    [
      compact ? 'flex-1 min-h-12 rounded-lg border text-sm font-bold' : 'flex-1 min-h-14 rounded-xl border text-sm font-semibold',
      metric === m ? 'bg-primary text-white border-primary' : 'border-border bg-white',
    ].join(' ');

  return (
    <div className={compact ? 'col-span-2 flex gap-1 items-end' : 'flex gap-2'}>
      {(['ANN_HARD', 'RW_TENSION'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          disabled={locked}
          className={btnClass(m)}
        >
          {m === 'ANN_HARD' ? 'Ann Hard' : 'R/W Tension'}
        </button>
      ))}
    </div>
  );
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
  const locked = readOnly || order.status === 'COMPLETED';

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

  const commitDecimalDraft = (field: SkinPassDecimalField) => {
    const parsed = parseDecimalDraft(drafts[field]);
    setDrafts((prev) => ({ ...prev, [field]: toDraft(parsed) }));
    setData((prev) => ({ ...prev, [field]: parsed }));
  };

  const saveLabel = combinedOrderCount && combinedOrderCount > 1
    ? `Save Production Data (${combinedOrderCount} orders)`
    : 'Save Production Data';

  const save = () => {
    const payload =
      metric === 'RW_TENSION'
        ? { ...data, ...parseRwTension(rwTensionInput) }
        : data;
    onSave(prepareSaveData(payload, metric));
  };

  if (compact) {
    return (
      <div className="flex flex-col">
        <div className="p-3">
          <div className="bg-white border border-border rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground">Skin Pass</h3>
          <span className="text-sm text-muted-foreground">
            Target Thickness: <span className="font-mono font-bold text-foreground">{order.targetThkMm} mm</span>
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          <FieldWrapper label="Output Thickness (mm)" prominent>
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
          <FieldWrapper
            label={isCombined ? 'Combined Actual Weight (Metric Tons)' : 'Actual Weight (Metric Tons)'}
            prominent
          >
            <ZInput
              type="number"
              inputMode="decimal"
              enterKeyHint="next"
              autoComplete="off"
              value={drafts.actualWeightMt}
              onChange={(e) => updateDecimalDraft('actualWeightMt', e.target.value)}
              onBlur={() => commitDecimalDraft('actualWeightMt')}
              className="min-h-12 text-lg"
              disabled={locked}
            />
            {isCombined && combinedTargetMt != null && (
              <p className="text-xs text-muted-foreground mt-1">
                Combined target: {combinedTargetMt} MT across {combinedOrderCount} orders
              </p>
            )}
          </FieldWrapper>
          <MetricToggle metric={metric} onChange={switchMetric} locked={locked} compact />
          {metric === 'ANN_HARD' ? (
            <FieldWrapper label="Annealing Hardness" prominent>
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
            <FieldWrapper label="R/W Tension" prominent>
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
          <div className="col-span-2 flex gap-1 items-end">
            {(['LOAD', 'STRETCH'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setData({ ...data, operatingMode: m })}
                disabled={locked}
                className={['flex-1 min-h-12 rounded-lg border text-sm font-bold', data.operatingMode === m ? 'bg-primary text-white' : 'border-border'].join(' ')}
              >
                {m === 'LOAD' ? 'Load Mode' : 'Stretch Mode'}
              </button>
            ))}
          </div>
          {data.operatingMode === 'LOAD' && (
            <>
              <FieldWrapper label="Load Minimum (Tonnes)" prominent>
                <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={drafts.loadMinT} onChange={(e) => updateDecimalDraft('loadMinT', e.target.value)} onBlur={() => commitDecimalDraft('loadMinT')} className="min-h-12 text-lg" disabled={locked} />
              </FieldWrapper>
              <FieldWrapper label="Load Maximum (Tonnes)" prominent>
                <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={drafts.loadMaxT} onChange={(e) => updateDecimalDraft('loadMaxT', e.target.value)} onBlur={() => commitDecimalDraft('loadMaxT')} className="min-h-12 text-lg" disabled={locked} />
              </FieldWrapper>
            </>
          )}
          {data.operatingMode === 'STRETCH' && (
            <FieldWrapper label="Stretch (%)" prominent>
              <ZInput type="number" inputMode="decimal" enterKeyHint="done" value={drafts.stretchPct} onChange={(e) => updateDecimalDraft('stretchPct', e.target.value)} onBlur={() => commitDecimalDraft('stretchPct')} className="min-h-12 text-lg" disabled={locked} />
            </FieldWrapper>
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
      <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
        <FieldWrapper label="Output Thickness (mm)">
          <ZInput type="number" inputMode="decimal" enterKeyHint="next" autoComplete="off" value={drafts.outputThkMm} onChange={(e) => updateDecimalDraft('outputThkMm', e.target.value)} onBlur={() => commitDecimalDraft('outputThkMm')} className="min-h-14 text-lg" disabled={locked} />
        </FieldWrapper>
        <FieldWrapper label={isCombined ? 'Combined Actual Weight (Metric Tons)' : 'Actual Weight (Metric Tons)'}>
          <ZInput type="number" inputMode="decimal" enterKeyHint="next" autoComplete="off" value={drafts.actualWeightMt} onChange={(e) => updateDecimalDraft('actualWeightMt', e.target.value)} onBlur={() => commitDecimalDraft('actualWeightMt')} className="min-h-14 text-lg" disabled={locked} />
          {isCombined && combinedTargetMt != null && (
            <p className="text-xs text-muted-foreground mt-1">
              Combined target: {combinedTargetMt} MT across {combinedOrderCount} orders
            </p>
          )}
        </FieldWrapper>
        <MetricToggle metric={metric} onChange={switchMetric} locked={locked} />
        {metric === 'ANN_HARD' ? (
          <FieldWrapper label="Annealing Hardness">
            <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={drafts.annHard} onChange={(e) => updateDecimalDraft('annHard', e.target.value)} onBlur={() => commitDecimalDraft('annHard')} className="min-h-14 text-lg" disabled={locked} />
          </FieldWrapper>
        ) : (
          <FieldWrapper label="R/W Tension">
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
      <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
        <div className="flex gap-2">
          {(['LOAD', 'STRETCH'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setData({ ...data, operatingMode: m })} disabled={locked} className={['flex-1 min-h-14 rounded-xl border text-sm font-semibold', data.operatingMode === m ? 'bg-primary text-white border-primary' : 'border-border bg-white'].join(' ')}>{m === 'LOAD' ? 'Load Mode' : 'Stretch Mode'}</button>
          ))}
        </div>
        {data.operatingMode === 'LOAD' && (
          <div className="grid grid-cols-2 gap-3">
            <FieldWrapper label="Load Minimum (Tonnes)"><ZInput type="number" inputMode="decimal" value={drafts.loadMinT} onChange={(e) => updateDecimalDraft('loadMinT', e.target.value)} onBlur={() => commitDecimalDraft('loadMinT')} className="min-h-14" disabled={locked} /></FieldWrapper>
            <FieldWrapper label="Load Maximum (Tonnes)"><ZInput type="number" inputMode="decimal" value={drafts.loadMaxT} onChange={(e) => updateDecimalDraft('loadMaxT', e.target.value)} onBlur={() => commitDecimalDraft('loadMaxT')} className="min-h-14" disabled={locked} /></FieldWrapper>
          </div>
        )}
        {data.operatingMode === 'STRETCH' && (
          <FieldWrapper label="Stretch (%)"><ZInput type="number" inputMode="decimal" value={drafts.stretchPct} onChange={(e) => updateDecimalDraft('stretchPct', e.target.value)} onBlur={() => commitDecimalDraft('stretchPct')} className="min-h-14" disabled={locked} /></FieldWrapper>
        )}
      </div>
      {!readOnly && (
      <ZButton variant="primary" size="lg" fullWidth onClick={save} disabled={busy || locked} className="min-h-14">{saveLabel}</ZButton>
      )}
    </div>
  );
}
