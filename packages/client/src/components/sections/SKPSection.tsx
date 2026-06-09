/**
 * SKPSection — Skin Pass Mill process section (Wave 2 capture workspace).
 *
 * Captures coil weights, coolant data, surface finish, and up to 6 per-pass thickness entries
 * per the canonical schema (txn.prod_skp).
 * 
 * Requirements: 3.1, 3.7
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { FieldWrapper } from '../forms/FieldWrapper';
import { useEntryForm } from '../../hooks/useEntryForm';
import { useGloveModeClasses } from '../../hooks/useGloveModeClasses';
import { autoSourceService } from '../../services/autoSourceService';
import { CaptureWorkspace } from '../capture/CaptureWorkspace';
import { ZKeypad } from '../primitives/ZKeypad';
import { ZBadge } from '../primitives/ZBadge';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { ReviewSubmitGate } from '../forms/ReviewSubmitGate';
import type { ProcessSectionProps } from '../../lib/processSectionRegistry';
import type { SKPEntry, SKPPass } from '@m1/shared-validation';

type SKPFormValues = Omit<SKPEntry, 'id' | 'createdAt' | 'updatedAt'> & {
  id: string;
};

const initialValues: SKPFormValues = {
  id: '',
  shiftLogId: '',
  coilNo: '',
  widthMm: 0,
  thkMm: 0,
  finalThkMm: 0,
  totalPasses: undefined,
  weightMt: 0,
  rwTensionKg: undefined,
  surfaceFinish: '',
  reRolling: false,
  holdMt: undefined,
  rejectionMt: undefined,
  wtRollingMt: undefined,
  wtRerollMt: undefined,
  wtSkinpassMt: undefined,
  wtScrapMt: undefined,
  rollsIn: undefined,
  rollsOut: undefined,
  coolantTempDegC: undefined,
  coolantPressKgCm2: undefined,
  passes: [],
  timeFrom: undefined,
  timeTo: undefined,
  remarks: undefined,
  slNo: undefined,
};

const FIELD_LABELS: Record<string, string> = {
  widthMm: 'Width',
  thkMm: 'Input Thk',
  finalThkMm: 'Final Thk',
  weightMt: 'Weight',
  totalPasses: 'Total Passes',
  rwTensionKg: 'RW Tension',
  holdMt: 'Hold',
  rejectionMt: 'Rejection',
  wtRollingMt: 'Rolling',
  wtRerollMt: 'Re-roll',
  wtSkinpassMt: 'Skinpass',
  wtScrapMt: 'Scrap',
  coolantTempDegC: 'Coolant Temp',
  coolantPressKgCm2: 'Coolant Press',
};

export function SKPSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const { inputHeight, inputPadding, controlGap } = useGloveModeClasses();

  const form = useEntryForm({
    processCode,
    initialValues: { ...initialValues, id: crypto.randomUUID() },
  });

  const [coilNo, setCoilNo] = useState(initialCoilNo ?? '');
  const [autoSourceStatus, setAutoSourceStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [passDrafts, setPassDrafts] = useState<string[]>(['']);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('coil');

  const handleCoilBlur = useCallback(async () => {
    if (!coilNo.trim()) return;
    setAutoSourceStatus('loading');
    try {
      const prefilled = await autoSourceService.getPrefilledFields('SKP', coilNo.trim());
      const fields = prefilled.fields;
      if (fields.widthMm) form.setValue('widthMm', fields.widthMm.value);
      if (fields.thkMm) form.setValue('thkMm', fields.thkMm.value);
      if (fields.weightMt) form.setValue('weightMt', fields.weightMt.value);
      form.setValue('coilNo', coilNo.trim());
      setAutoSourceStatus('done');
    } catch {
      setAutoSourceStatus('error');
      form.setValue('coilNo', coilNo.trim());
    }
  }, [coilNo, form]);

  useEffect(() => {
    const validPasses = passDrafts.map(p => parseFloat(p)).filter(p => !isNaN(p));
    if (validPasses.length > 0) {
      form.setValue('totalPasses', validPasses.length);
      form.setValue('finalThkMm', validPasses[validPasses.length - 1]);
    } else {
      form.setValue('totalPasses', undefined);
      form.setValue('finalThkMm', undefined);
    }
  }, [passDrafts, form]);

  const getNumericValue = (field: string): string => {
    if (field.startsWith('pass_')) {
      const idx = parseInt(field.replace('pass_', ''), 10);
      return passDrafts[idx] ?? '';
    }
    const v = (form.values as Record<string, unknown>)[field];
    return v !== undefined && v !== 0 && v !== '' ? String(v) : '';
  };

  const setNumericValue = (field: string, val: string) => {
    if (field.startsWith('pass_')) {
      const idx = parseInt(field.replace('pass_', ''), 10);
      const newDrafts = [...passDrafts];
      newDrafts[idx] = val;
      setPassDrafts(newDrafts);
      return;
    }
    form.setValue(field as keyof typeof form.values, val === '' ? 0 : parseFloat(val));
  };

  const inputBtnClass = (field: string) =>
    [
      inputHeight,
      'flex-1 rounded-sm border text-sm font-mono text-left tabular-nums',
      inputPadding,
      'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
      activeField === field
        ? 'border-accent bg-accent/10 text-accent'
        : 'border-border bg-background text-foreground hover:border-accent/30',
    ].join(' ');

  const handleSave = async () => {
    const compiledPasses: SKPPass[] = passDrafts
      .map((val, idx) => ({ passNo: idx + 1, thicknessMm: parseFloat(val) }))
      .filter((p) => !isNaN(p.thicknessMm));
    form.setValue('passes', compiledPasses);
    form.setValue('coilNo', coilNo.trim());
    return form.save();
  };

  const fieldError = (field: string) => form.errors.find((e) => e.field === field)?.message;

  const activeFieldLabel = activeField
    ? activeField.startsWith('pass_')
      ? `Pass ${parseInt(activeField.replace('pass_', ''), 10) + 1} Thk`
      : FIELD_LABELS[activeField] ?? activeField
    : undefined;

  const statusBar = (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/40 text-xs">
      {form.saveStatus === 'queued' && <ZBadge tone="warning" label="Queued" />}
      {form.saveStatus === 'transmitted' && <ZBadge tone="success" label="Transmitted" />}
      {form.saveStatus === 'failed' && <ZBadge tone="destructive" label="Save failed" />}
      {autoSourceStatus === 'loading' && (
        <span className="text-muted-foreground animate-pulse">Auto-fill…</span>
      )}
      {autoSourceStatus === 'done' && <ZBadge tone="info" label="Auto-filled" />}
      {autoSourceStatus === 'error' && <ZBadge tone="warning" label="Auto-source off" />}
    </div>
  );

  const coilTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <div className="md:col-span-2">
        <ZInput
          label="Coil number"
          value={coilNo}
          onChange={(e) => setCoilNo(e.target.value)}
          onBlur={handleCoilBlur}
          placeholder="C-SKP-001"
          error={fieldError('coilNo')}
        />
      </div>

      <FieldWrapper label="Width (mm)" error={fieldError('widthMm')}>
        <button type="button" className={inputBtnClass('widthMm')} onClick={() => setActiveField('widthMm')}>
          {getNumericValue('widthMm') || '—'}
        </button>
      </FieldWrapper>

      <div className={`flex ${controlGap}`}>
        <FieldWrapper label="Input Thk (mm)" error={fieldError('thkMm')}>
          <button type="button" className={inputBtnClass('thkMm')} onClick={() => setActiveField('thkMm')}>
            {getNumericValue('thkMm') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Final Thk (mm)">
          <div className={`${inputHeight} flex items-center px-3 rounded-sm bg-secondary border border-border text-sm font-mono text-muted-foreground`}>
            {form.values.finalThkMm || '—'} (Auto)
          </div>
        </FieldWrapper>
      </div>

      <div className={`flex ${controlGap}`}>
        <FieldWrapper label="Weight (MT)" error={fieldError('weightMt')}>
          <button type="button" className={inputBtnClass('weightMt')} onClick={() => setActiveField('weightMt')}>
            {getNumericValue('weightMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Total Passes">
          <div className={`${inputHeight} flex items-center px-3 rounded-sm bg-secondary border border-border text-sm font-mono text-muted-foreground`}>
            {form.values.totalPasses || '—'} (Auto)
          </div>
        </FieldWrapper>
      </div>

      <ZInput
        label="Surface Finish"
        value={form.values.surfaceFinish}
        onChange={(e) => form.setValue('surfaceFinish', e.target.value)}
        placeholder="Surface finish"
        error={fieldError('surfaceFinish')}
      />

      <FieldWrapper label="Re-Rolling">
        <label className={`${inputHeight} flex items-center gap-2 border border-border rounded-sm px-3 bg-card cursor-pointer hover:bg-secondary`}>
          <input
            type="checkbox"
            checked={form.values.reRolling}
            onChange={(e) => form.setValue('reRolling', e.target.checked)}
            className="accent-primary"
          />
          <span className="text-sm">Yes</span>
        </label>
      </FieldWrapper>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <ZInput label="Rolls In" value={form.values.rollsIn ?? ''} onChange={(e) => form.setValue('rollsIn', e.target.value || undefined)} placeholder="Roll In ID" />
        <ZInput label="Rolls Out" value={form.values.rollsOut ?? ''} onChange={(e) => form.setValue('rollsOut', e.target.value || undefined)} placeholder="Roll Out ID" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:col-span-2">
        <FieldWrapper label="Hold MT" error={fieldError('holdMt')}>
          <button type="button" className={inputBtnClass('holdMt')} onClick={() => setActiveField('holdMt')}>
            {getNumericValue('holdMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Rejection MT" error={fieldError('rejectionMt')}>
          <button type="button" className={inputBtnClass('rejectionMt')} onClick={() => setActiveField('rejectionMt')}>
            {getNumericValue('rejectionMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Rolling MT" error={fieldError('wtRollingMt')}>
          <button type="button" className={inputBtnClass('wtRollingMt')} onClick={() => setActiveField('wtRollingMt')}>
            {getNumericValue('wtRollingMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Re-roll MT" error={fieldError('wtRerollMt')}>
          <button type="button" className={inputBtnClass('wtRerollMt')} onClick={() => setActiveField('wtRerollMt')}>
            {getNumericValue('wtRerollMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Skinpass MT" error={fieldError('wtSkinpassMt')}>
          <button type="button" className={inputBtnClass('wtSkinpassMt')} onClick={() => setActiveField('wtSkinpassMt')}>
            {getNumericValue('wtSkinpassMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Scrap MT" error={fieldError('wtScrapMt')}>
          <button type="button" className={inputBtnClass('wtScrapMt')} onClick={() => setActiveField('wtScrapMt')}>
            {getNumericValue('wtScrapMt') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="Coolant Temp (°C)" error={fieldError('coolantTempDegC')}>
          <button type="button" className={inputBtnClass('coolantTempDegC')} onClick={() => setActiveField('coolantTempDegC')}>
            {getNumericValue('coolantTempDegC') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Coolant Press (kg/cm²)" error={fieldError('coolantPressKgCm2')}>
          <button type="button" className={inputBtnClass('coolantPressKgCm2')} onClick={() => setActiveField('coolantPressKgCm2')}>
            {getNumericValue('coolantPressKgCm2') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <FieldWrapper label="RW Tension (kg)" error={fieldError('rwTensionKg')}>
        <button type="button" className={inputBtnClass('rwTensionKg')} onClick={() => setActiveField('rwTensionKg')}>
          {getNumericValue('rwTensionKg') || '—'}
        </button>
      </FieldWrapper>

      <div className={`flex ${controlGap}`}>
        <FieldWrapper label="Time from" error={fieldError('timeFrom')}>
          <input
            type="time"
            value={String(form.values.timeFrom ?? '')}
            onChange={(e) => form.setValue('timeFrom', e.target.value || undefined)}
            className={`${inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50`}
          />
        </FieldWrapper>
        <FieldWrapper label="Time to" error={fieldError('timeTo')}>
          <input
            type="time"
            value={String(form.values.timeTo ?? '')}
            onChange={(e) => form.setValue('timeTo', e.target.value || undefined)}
            className={`${inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50`}
          />
        </FieldWrapper>
      </div>
    </div>
  );

  const passesTab = (
    <div className="max-w-2xl flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="z-rail-label">Pass thickness entries ({passDrafts.length})</span>
        <ZButton variant="secondary" size="sm" onClick={() => setPassDrafts([...passDrafts, ''])}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add pass
        </ZButton>
      </div>
      {fieldError('passes') && (
        <p className="text-xs text-destructive">{fieldError('passes')}</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {passDrafts.map((_, idx) => (
          <div key={idx} className="flex flex-col gap-2">
            <FieldWrapper label={`Pass ${idx + 1} (mm)`}>
              <button
                type="button"
                className={inputBtnClass(`pass_${idx}`)}
                onClick={() => setActiveField(`pass_${idx}`)}
              >
                {getNumericValue(`pass_${idx}`) || '—'}
              </button>
            </FieldWrapper>
            {idx > 0 && (
              <button
                type="button"
                onClick={() => setPassDrafts(prev => prev.filter((_, i) => i !== idx))}
                className="text-xs text-destructive hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const summary = (
    <div className="p-4 flex flex-col gap-4 h-full">
      <span className="z-rail-label">Live summary</span>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Coil</dt>
          <dd className="font-mono text-xs">{coilNo || '—'}</dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Weight</dt>
          <dd className="font-mono">{form.values.weightMt || '—'} MT</dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Width</dt>
          <dd className="font-mono">{form.values.widthMm || '—'} mm</dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Input → Final</dt>
          <dd className="font-mono text-xs">
            {form.values.thkMm || '—'} → {form.values.finalThkMm || '—'} mm
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Passes</dt>
          <dd className="font-mono">{form.values.totalPasses || '—'}</dd>
        </div>
      </dl>
      {form.errors.filter((e) => e.field === '_form').map((e) => (
        <p key={e.field} className="text-xs text-destructive">{e.message}</p>
      ))}
    </div>
  );

  return (
    <CaptureWorkspace
      statusBar={statusBar}
      tabs={[
        { id: 'coil', label: 'Coil', content: coilTab },
        { id: 'passes', label: 'Passes', content: passesTab },
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      summary={summary}
      keypad={
        activeField ? (
          <ZKeypad
            value={getNumericValue(activeField)}
            onChange={(val) => setNumericValue(activeField, val)}
            activeLabel={activeFieldLabel}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Tap a numeric field to enter values
          </div>
        )
      }
      footer={
        <ReviewSubmitGate
          values={form.values}
          errors={form.errors}
          isDirty={form.isDirty}
          saveStatus={form.saveStatus}
          onSave={handleSave}
        />
      }
    />
  );
}
