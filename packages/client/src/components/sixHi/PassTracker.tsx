import { useEffect, useState } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import type { SixHiRollingPass } from '@m1/shared-validation';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import {
  formatPassThickness,
  isPassThicknessDraft,
  parsePassThickness,
} from '../../lib/parsePassThickness';

interface PassTrackerProps {
  passes: SixHiRollingPass[];
  onChange: (passes: SixHiRollingPass[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

function passesStructureKey(passes: SixHiRollingPass[]): string {
  return passes.map((p) => p.passNo).join(',');
}

function toDrafts(passes: SixHiRollingPass[]): string[] {
  return passes.map((p) => formatPassThickness(p.thicknessMm));
}

export function PassTracker({ passes, onChange, disabled, compact }: PassTrackerProps) {
  const [drafts, setDrafts] = useState<string[]>(() => toDrafts(passes));
  const [structureKey, setStructureKey] = useState(() => passesStructureKey(passes));

  useEffect(() => {
    const nextKey = passesStructureKey(passes);
    if (nextKey !== structureKey || drafts.length !== passes.length) {
      setStructureKey(nextKey);
      setDrafts(toDrafts(passes));
    }
  }, [passes, structureKey, drafts.length]);

  const addPass = () => {
    const last = passes[passes.length - 1];
    const nextThk = last ? Math.max(0.1, last.thicknessMm - 0.2) : 2.0;
    onChange([...passes, { passNo: passes.length + 1, thicknessMm: Math.round(nextThk * 100) / 100 }]);
  };

  const updatePassDraft = (idx: number, raw: string) => {
    if (!isPassThicknessDraft(raw)) return;

    const nextDrafts = [...drafts];
    nextDrafts[idx] = raw;
    setDrafts(nextDrafts);

    const next = [...passes];
    if (!raw.trim() || raw === '.') {
      next[idx] = { ...next[idx], thicknessMm: 0 };
    } else if (!raw.endsWith('.')) {
      next[idx] = { ...next[idx], thicknessMm: parsePassThickness(raw) };
    }
    onChange(next);
  };

  const commitPassDraft = (idx: number) => {
    const raw = drafts[idx] ?? '';
    if (!raw.trim() || raw === '.') {
      const nextDrafts = [...drafts];
      nextDrafts[idx] = '';
      setDrafts(nextDrafts);
      const next = [...passes];
      next[idx] = { ...next[idx], thicknessMm: 0 };
      onChange(next);
      return;
    }

    const parsed = parsePassThickness(raw);
    const nextDrafts = [...drafts];
    nextDrafts[idx] = parsed > 0 ? formatPassThickness(parsed) : '';
    setDrafts(nextDrafts);

    const next = [...passes];
    next[idx] = { ...next[idx], thicknessMm: parsed };
    onChange(next);
  };

  const removePass = (idx: number) => {
    onChange(passes.filter((_, i) => i !== idx).map((p, i) => ({ ...p, passNo: i + 1 })));
  };

  const finalThk = passes.length > 0 ? passes[passes.length - 1].thicknessMm : undefined;

  const renderPassInput = (p: SixHiRollingPass, idx: number, inputClassName: string) => {
    const prev = idx > 0 ? passes[idx - 1] : null;
    const isIncreasing = prev != null && p.thicknessMm > 0 && prev.thicknessMm > 0 && p.thicknessMm >= prev.thicknessMm;

    return (
      <div key={p.passNo} className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-muted-foreground w-[4.5rem] shrink-0">Pass {p.passNo}</span>
          <ZInput
            type="number"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            step="any"
            value={drafts[idx] ?? ''}
            onChange={(e) => updatePassDraft(idx, e.target.value)}
            onBlur={() => commitPassDraft(idx)}
            className={`${inputClassName} ${isIncreasing ? 'border-warning/50 bg-warning/5' : ''}`}
            placeholder="mm"
            disabled={disabled}
          />
          <button type="button" onClick={() => removePass(idx)} disabled={disabled} className="min-h-12 min-w-10 text-muted-foreground">
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
        {isIncreasing && (
          <span className="text-xs text-warning font-medium flex items-center gap-1 pl-[4.5rem]">
            <AlertTriangle className="h-3 w-3" />
            Must be thinner than Pass {prev.passNo} ({prev.thicknessMm}mm)
          </span>
        )}
      </div>
    );
  };

  if (compact) {
    return (
      <div className="flex flex-col min-h-0 h-full">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <h3 className="text-base font-bold text-foreground">Passes</h3>
          <button
            type="button"
            onClick={addPass}
            disabled={disabled}
            className="min-h-11 px-3 rounded-lg border border-border text-sm font-bold text-foreground flex items-center gap-1"
          >
            <Plus className="h-5 w-5" /> Add Pass
          </button>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 flex-1 content-start">
          {passes.map((p, idx) => renderPassInput(p, idx, 'min-h-12 text-lg flex-1'))}
        </div>
        <p className="text-sm text-muted-foreground mt-2 shrink-0">
          {passes.length} {passes.length === 1 ? 'Pass' : 'Passes'} · Final Thickness{' '}
          <span className="font-mono font-bold text-foreground">{finalThk != null && finalThk > 0 ? `${finalThk} mm` : '—'}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Passes</h3>
        <ZButton variant="ghost" size="sm" onClick={addPass} disabled={disabled}>
          <Plus className="h-4 w-4" /> Add Pass
        </ZButton>
      </div>
      {passes.length === 0 && (
        <p className="text-sm text-muted-foreground">No passes recorded. Tap Add Pass to prepare rolling data.</p>
      )}
      <div className="space-y-2">
        {passes.map((p, idx) => {
          const prev = idx > 0 ? passes[idx - 1] : null;
          const isIncreasing = prev != null && p.thicknessMm > 0 && prev.thicknessMm > 0 && p.thicknessMm >= prev.thicknessMm;
          return (
            <div key={p.passNo} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="w-16 font-mono text-sm font-semibold text-foreground">Pass {p.passNo}</span>
                <ZInput
                  type="number"
                  inputMode="decimal"
                  enterKeyHint="next"
                  autoComplete="off"
                  step="any"
                  value={drafts[idx] ?? ''}
                  onChange={(e) => updatePassDraft(idx, e.target.value)}
                  onBlur={() => commitPassDraft(idx)}
                  className={`flex-1 min-h-14 text-lg ${isIncreasing ? 'border-warning/50 bg-warning/5' : ''}`}
                  placeholder="mm"
                  disabled={disabled}
                />
                <ZButton variant="ghost" size="sm" onClick={() => removePass(idx)} disabled={disabled} className="min-h-14 min-w-14">
                  <Trash2 className="h-4 w-4" />
                </ZButton>
              </div>
              {isIncreasing && (
                <span className="text-xs text-warning font-medium flex items-center gap-1 pl-[4.5rem]">
                  <AlertTriangle className="h-3 w-3" />
                  Must be thinner than Pass {prev.passNo} ({prev.thicknessMm}mm)
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 bg-secondary rounded-xl p-3 text-sm">
        <div>Total Passes: <strong>{passes.length}</strong></div>
        <div>Final Thickness: <strong className="font-mono">{finalThk != null && finalThk > 0 ? `${finalThk} mm` : '—'}</strong></div>
      </div>
    </div>
  );
}
