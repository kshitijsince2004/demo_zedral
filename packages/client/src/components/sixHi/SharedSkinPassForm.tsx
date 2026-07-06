import { useState } from 'react';
import type { SixHiOrderDetail, SixHiSkinPassData } from '@m1/shared-validation';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';

type SkinPassMetric = 'ANN_HARD' | 'RW_TENSION';

interface SkinPassWorkspaceProps {
  order: SixHiOrderDetail;
  onSave: (data: SixHiSkinPassData) => Promise<void>;
  busy?: boolean;
  compact?: boolean;
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

export function SharedSkinPassForm({ order, onSave, busy, compact }: SkinPassWorkspaceProps) {
  const [data, setData] = useState<SixHiSkinPassData>(order.skinPass ?? {});
  const [metric, setMetric] = useState<SkinPassMetric>(() => initialMetricChoice(order.skinPass));
  const [rwTensionInput, setRwTensionInput] = useState(() =>
    formatRwTension(order.skinPass?.rwTension1, order.skinPass?.rwTension2),
  );
  const locked = order.status === 'COMPLETED';

  const switchMetric = (next: SkinPassMetric) => {
    setMetric(next);
    if (next === 'ANN_HARD') {
      setRwTensionInput('');
      setData((prev) => ({ ...prev, rwTension1: undefined, rwTension2: undefined }));
    } else {
      setData((prev) => ({ ...prev, annHard: undefined }));
    }
  };

  const updateRwTensionInput = (value: string) => {
    setRwTensionInput(value);
    setData((prev) => ({ ...prev, ...parseRwTension(value) }));
  };

  const save = () => {
    const payload =
      metric === 'RW_TENSION'
        ? { ...data, ...parseRwTension(rwTensionInput) }
        : data;
    onSave(prepareSaveData(payload, metric));
  };

  if (compact) {
    return (
      <div className="flex flex-col min-h-0 flex-1 h-full">
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
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
              value={data.outputThkMm ?? ''}
              onChange={(e) => setData({ ...data, outputThkMm: e.target.value ? Number(e.target.value) : undefined })}
              className="min-h-12 text-lg"
              disabled={locked}
            />
          </FieldWrapper>
          <FieldWrapper label="Actual Weight (Metric Tons)" prominent>
            <ZInput
              type="number"
              inputMode="decimal"
              enterKeyHint="next"
              autoComplete="off"
              value={data.actualWeightMt ?? ''}
              onChange={(e) => setData({ ...data, actualWeightMt: e.target.value ? Number(e.target.value) : undefined })}
              className="min-h-12 text-lg"
              disabled={locked}
            />
          </FieldWrapper>
          <MetricToggle metric={metric} onChange={switchMetric} locked={locked} compact />
          {metric === 'ANN_HARD' ? (
            <FieldWrapper label="Annealing Hardness" prominent>
              <ZInput
                type="number"
                inputMode="decimal"
                enterKeyHint="next"
                value={data.annHard ?? ''}
                onChange={(e) => setData({ ...data, annHard: e.target.value ? Number(e.target.value) : undefined })}
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
                <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={data.loadMinT ?? ''} onChange={(e) => setData({ ...data, loadMinT: Number(e.target.value) })} className="min-h-12 text-lg" disabled={locked} />
              </FieldWrapper>
              <FieldWrapper label="Load Maximum (Tonnes)" prominent>
                <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={data.loadMaxT ?? ''} onChange={(e) => setData({ ...data, loadMaxT: Number(e.target.value) })} className="min-h-12 text-lg" disabled={locked} />
              </FieldWrapper>
            </>
          )}
          {data.operatingMode === 'STRETCH' && (
            <FieldWrapper label="Stretch (%)" prominent>
              <ZInput type="number" inputMode="decimal" enterKeyHint="done" value={data.stretchPct ?? ''} onChange={(e) => setData({ ...data, stretchPct: Number(e.target.value) })} className="min-h-12 text-lg" disabled={locked} />
            </FieldWrapper>
          )}
        </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-card px-3 py-2">
          <ZButton variant="primary" size="lg" fullWidth onClick={save} disabled={busy || locked} className="min-h-14 text-base font-bold">
            Save Production Data
          </ZButton>
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
          <ZInput type="number" inputMode="decimal" enterKeyHint="next" autoComplete="off" value={data.outputThkMm ?? ''} onChange={(e) => setData({ ...data, outputThkMm: e.target.value ? Number(e.target.value) : undefined })} className="min-h-14 text-lg" disabled={locked} />
        </FieldWrapper>
        <FieldWrapper label="Actual Weight (Metric Tons)">
          <ZInput type="number" inputMode="decimal" enterKeyHint="next" autoComplete="off" value={data.actualWeightMt ?? ''} onChange={(e) => setData({ ...data, actualWeightMt: e.target.value ? Number(e.target.value) : undefined })} className="min-h-14 text-lg" disabled={locked} />
        </FieldWrapper>
        <MetricToggle metric={metric} onChange={switchMetric} locked={locked} />
        {metric === 'ANN_HARD' ? (
          <FieldWrapper label="Annealing Hardness">
            <ZInput type="number" inputMode="decimal" enterKeyHint="next" value={data.annHard ?? ''} onChange={(e) => setData({ ...data, annHard: e.target.value ? Number(e.target.value) : undefined })} className="min-h-14 text-lg" disabled={locked} />
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
            <FieldWrapper label="Load Minimum (Tonnes)"><ZInput type="number" inputMode="decimal" value={data.loadMinT ?? ''} onChange={(e) => setData({ ...data, loadMinT: Number(e.target.value) })} className="min-h-14" disabled={locked} /></FieldWrapper>
            <FieldWrapper label="Load Maximum (Tonnes)"><ZInput type="number" inputMode="decimal" value={data.loadMaxT ?? ''} onChange={(e) => setData({ ...data, loadMaxT: Number(e.target.value) })} className="min-h-14" disabled={locked} /></FieldWrapper>
          </div>
        )}
        {data.operatingMode === 'STRETCH' && (
          <FieldWrapper label="Stretch (%)"><ZInput type="number" inputMode="decimal" value={data.stretchPct ?? ''} onChange={(e) => setData({ ...data, stretchPct: Number(e.target.value) })} className="min-h-14" disabled={locked} /></FieldWrapper>
        )}
      </div>
      <ZButton variant="primary" size="lg" fullWidth onClick={save} disabled={busy || locked} className="min-h-14">Save Production Data</ZButton>
    </div>
  );
}
