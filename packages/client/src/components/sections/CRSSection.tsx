/**
 * CRSSection — CR Slitter process section (Wave 2 capture workspace).
 *
 * Captures the full CRS quality block, actual thickness front/rear, roughness,
 * coating weights, RP oil grade, and slit slots (A-D).
 *
 * Requirements: 3.1, 3.9, 3.11
 */

import { useState, useCallback } from 'react';
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
import type { CRSEntry, CRSSlitSlot } from '@m1/shared-validation';

type CRSFormValues = Omit<CRSEntry, 'id' | 'createdAt' | 'updatedAt'> & {
  id: string;
};

interface SlitSlotDraft {
  label: 'A' | 'B' | 'C' | 'D';
  widthMm: string;
  childCoilNo: string;
}

const SLOT_LABELS: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

const initialValues: CRSFormValues = {
  id: '',
  shiftLogId: '',
  coilNo: '',
  slitNo: '',
  coilWidthMm: 0,
  nominalThkMm: 0,
  actualWidthMm: undefined,
  actualThkFrontMm: undefined,
  actualThkRearMm: undefined,
  hardnessVpn: undefined,
  hardnessHrb: undefined,
  ibTiecv: undefined,
  utsNmm2: undefined,
  elongationPct: undefined,
  ysrBurr: undefined,
  camberWaviness: undefined,
  raUm: undefined,
  rzUm: undefined,
  outputWtMt: 0,
  rejectionOdMt: undefined,
  rejectionIdMt: undefined,
  coatingWtBr: undefined,
  coatingWtMatt: undefined,
  rpOilGrade: undefined,
  holdMt: undefined,
  forCtlMt: undefined,
  slitSlots: [],
  timeFrom: undefined,
  timeTo: undefined,
  remarks: undefined,
  slNo: undefined,
};

const FIELD_LABELS: Record<string, string> = {
  coilWidthMm: 'Coil width',
  nominalThkMm: 'Nom thickness',
  actualWidthMm: 'Act width',
  actualThkFrontMm: 'Thk front',
  actualThkRearMm: 'Thk rear',
  hardnessVpn: 'Hardness VPN',
  hardnessHrb: 'Hardness HRB',
  utsNmm2: 'UTS',
  elongationPct: 'Elongation',
  raUm: 'Ra',
  rzUm: 'Rz',
  outputWtMt: 'Output wt',
  rejectionOdMt: 'Rejection OD',
  rejectionIdMt: 'Rejection ID',
  coatingWtBr: 'Coating Bright',
  coatingWtMatt: 'Coating Matt',
  holdMt: 'Hold',
  forCtlMt: 'For CTL',
};

export function CRSSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const { inputHeight, inputPadding, controlGap } = useGloveModeClasses();

  const form = useEntryForm({
    processCode,
    initialValues: { ...initialValues, id: crypto.randomUUID() },
  });

  const [coilNo, setCoilNo] = useState(initialCoilNo ?? '');
  const [slitNo, setSlitNo] = useState('');
  const [autoSourceStatus, setAutoSourceStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [slitSlots, setSlitSlots] = useState<SlitSlotDraft[]>([]);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('coil');

  const handleCoilBlur = useCallback(async () => {
    if (!coilNo.trim()) return;
    setAutoSourceStatus('loading');
    try {
      const prefilled = await autoSourceService.getPrefilledFields('CRS', coilNo.trim());
      const fields = prefilled.fields;
      if (fields.coilWidthMm) form.setValue('coilWidthMm', fields.coilWidthMm.value);
      if (fields.nominalThkMm) form.setValue('nominalThkMm', fields.nominalThkMm.value);
      form.setValue('coilNo', coilNo.trim());
      setAutoSourceStatus('done');
    } catch {
      setAutoSourceStatus('error');
      form.setValue('coilNo', coilNo.trim());
    }
  }, [coilNo, form]);

  const updateSlot = (idx: number, field: keyof SlitSlotDraft, value: string) => {
    setSlitSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const getNumericValue = (field: string): string => {
    if (field.startsWith('slot_w_')) {
      const idx = parseInt(field.replace('slot_w_', ''), 10);
      return slitSlots[idx]?.widthMm ?? '';
    }
    const v = (form.values as Record<string, unknown>)[field];
    return v !== undefined && v !== 0 && v !== '' ? String(v) : '';
  };

  const setNumericValue = (field: string, val: string) => {
    if (field.startsWith('slot_w_')) {
      const idx = parseInt(field.replace('slot_w_', ''), 10);
      updateSlot(idx, 'widthMm', val);
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

  const handleAddSlot = () => {
    if (slitSlots.length >= 4) return;
    const label = SLOT_LABELS[slitSlots.length];
    setSlitSlots((prev) => [...prev, { label, widthMm: '', childCoilNo: '' }]);
  };

  const handleRemoveSlot = (idx: number) => {
    setSlitSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const parsedSlots: CRSSlitSlot[] = slitSlots
      .filter((s) => s.widthMm !== '')
      .map((s) => ({
        label: s.label,
        widthMm: parseFloat(s.widthMm) || 0,
        childCoilNo: s.childCoilNo || undefined,
      }));
    form.setValue('slitSlots', parsedSlots);
    form.setValue('coilNo', coilNo.trim());
    form.setValue('slitNo', slitNo.trim());
    return form.save();
  };

  const fieldError = (field: string) => form.errors.find((e) => e.field === field)?.message;

  const activeFieldLabel = activeField
    ? activeField.startsWith('slot_w_')
      ? `Slot ${slitSlots[parseInt(activeField.replace('slot_w_', ''), 10)]?.label} width`
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
          placeholder="C-CRS-001"
          error={fieldError('coilNo')}
        />
      </div>

      <ZInput
        label="Slit No"
        value={slitNo}
        onChange={(e) => setSlitNo(e.target.value)}
        placeholder="Slit No"
        error={fieldError('slitNo')}
      />

      <FieldWrapper label="Coil Width (mm)" error={fieldError('coilWidthMm')}>
        <button type="button" className={inputBtnClass('coilWidthMm')} onClick={() => setActiveField('coilWidthMm')}>
          {getNumericValue('coilWidthMm') || '—'}
        </button>
      </FieldWrapper>

      <FieldWrapper label="Nom Thk (mm)" error={fieldError('nominalThkMm')}>
        <button type="button" className={inputBtnClass('nominalThkMm')} onClick={() => setActiveField('nominalThkMm')}>
          {getNumericValue('nominalThkMm') || '—'}
        </button>
      </FieldWrapper>

      <FieldWrapper label="Act Width (mm)" error={fieldError('actualWidthMm')}>
        <button type="button" className={inputBtnClass('actualWidthMm')} onClick={() => setActiveField('actualWidthMm')}>
          {getNumericValue('actualWidthMm') || '—'}
        </button>
      </FieldWrapper>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="Thk Front (mm)" error={fieldError('actualThkFrontMm')}>
          <button type="button" className={inputBtnClass('actualThkFrontMm')} onClick={() => setActiveField('actualThkFrontMm')}>
            {getNumericValue('actualThkFrontMm') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Thk Rear (mm)" error={fieldError('actualThkRearMm')}>
          <button type="button" className={inputBtnClass('actualThkRearMm')} onClick={() => setActiveField('actualThkRearMm')}>
            {getNumericValue('actualThkRearMm') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <div className="md:col-span-2">
        <ZInput
          label="RP Oil Grade"
          value={form.values.rpOilGrade ?? ''}
          onChange={(e) => form.setValue('rpOilGrade', e.target.value || undefined)}
          placeholder="RP Oil Grade"
          error={fieldError('rpOilGrade')}
        />
      </div>

      <div className={`flex ${controlGap} md:col-span-2`}>
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

  const qualityTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="Hardness VPN" error={fieldError('hardnessVpn')}>
          <button type="button" className={inputBtnClass('hardnessVpn')} onClick={() => setActiveField('hardnessVpn')}>
            {getNumericValue('hardnessVpn') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Hardness HRB" error={fieldError('hardnessHrb')}>
          <button type="button" className={inputBtnClass('hardnessHrb')} onClick={() => setActiveField('hardnessHrb')}>
            {getNumericValue('hardnessHrb') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="UTS (N/mm²)" error={fieldError('utsNmm2')}>
          <button type="button" className={inputBtnClass('utsNmm2')} onClick={() => setActiveField('utsNmm2')}>
            {getNumericValue('utsNmm2') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Elongation %" error={fieldError('elongationPct')}>
          <button type="button" className={inputBtnClass('elongationPct')} onClick={() => setActiveField('elongationPct')}>
            {getNumericValue('elongationPct') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <div className="md:col-span-2">
        <ZInput
          label="IB TIECV"
          value={form.values.ibTiecv ?? ''}
          onChange={(e) => form.setValue('ibTiecv', e.target.value || undefined)}
          placeholder="IB TIECV"
          error={fieldError('ibTiecv')}
        />
      </div>

      <div className="md:col-span-2">
        <ZInput
          label="YSR Burr"
          value={form.values.ysrBurr ?? ''}
          onChange={(e) => form.setValue('ysrBurr', e.target.value || undefined)}
          placeholder="YSR Burr"
          error={fieldError('ysrBurr')}
        />
      </div>

      <div className="md:col-span-2">
        <ZInput
          label="Camber/Waviness"
          value={form.values.camberWaviness ?? ''}
          onChange={(e) => form.setValue('camberWaviness', e.target.value || undefined)}
          placeholder="Camber/Waviness"
          error={fieldError('camberWaviness')}
        />
      </div>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="Ra (µm)" error={fieldError('raUm')}>
          <button type="button" className={inputBtnClass('raUm')} onClick={() => setActiveField('raUm')}>
            {getNumericValue('raUm') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Rz (µm)" error={fieldError('rzUm')}>
          <button type="button" className={inputBtnClass('rzUm')} onClick={() => setActiveField('rzUm')}>
            {getNumericValue('rzUm') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="Coating Bright" error={fieldError('coatingWtBr')}>
          <button type="button" className={inputBtnClass('coatingWtBr')} onClick={() => setActiveField('coatingWtBr')}>
            {getNumericValue('coatingWtBr') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Coating Matt" error={fieldError('coatingWtMatt')}>
          <button type="button" className={inputBtnClass('coatingWtMatt')} onClick={() => setActiveField('coatingWtMatt')}>
            {getNumericValue('coatingWtMatt') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="Output Wt (MT)" error={fieldError('outputWtMt')}>
          <button type="button" className={inputBtnClass('outputWtMt')} onClick={() => setActiveField('outputWtMt')}>
            {getNumericValue('outputWtMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Hold MT" error={fieldError('holdMt')}>
          <button type="button" className={inputBtnClass('holdMt')} onClick={() => setActiveField('holdMt')}>
            {getNumericValue('holdMt') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="Rejection OD (MT)" error={fieldError('rejectionOdMt')}>
          <button type="button" className={inputBtnClass('rejectionOdMt')} onClick={() => setActiveField('rejectionOdMt')}>
            {getNumericValue('rejectionOdMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Rejection ID (MT)" error={fieldError('rejectionIdMt')}>
          <button type="button" className={inputBtnClass('rejectionIdMt')} onClick={() => setActiveField('rejectionIdMt')}>
            {getNumericValue('rejectionIdMt') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <FieldWrapper label="For CTL (MT)" error={fieldError('forCtlMt')}>
        <button type="button" className={inputBtnClass('forCtlMt')} onClick={() => setActiveField('forCtlMt')}>
          {getNumericValue('forCtlMt') || '—'}
        </button>
      </FieldWrapper>
    </div>
  );

  const slotsTab = (
    <div className="max-w-2xl flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="z-rail-label">Slit slots ({slitSlots.length}/4)</span>
        <ZButton variant="secondary" size="sm" onClick={handleAddSlot} disabled={slitSlots.length >= 4}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add slot
        </ZButton>
      </div>
      {fieldError('slitSlots') && (
        <p className="text-xs text-destructive">{fieldError('slitSlots')}</p>
      )}
      {slitSlots.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-sm">
          No slots — add up to four child coils
        </p>
      ) : (
        slitSlots.map((slot, idx) => (
          <div key={slot.label} className="border border-border rounded-sm p-3 bg-background/50">
            <div className="flex items-center justify-between mb-2">
              <span className="z-rail-label">Slot {slot.label}</span>
              <button
                type="button"
                onClick={() => handleRemoveSlot(idx)}
                className="text-destructive hover:text-destructive/80 p-1"
                aria-label={`Remove slot ${slot.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <input
                placeholder="Child coil no"
                value={slot.childCoilNo}
                onChange={(e) => updateSlot(idx, 'childCoilNo', e.target.value)}
                className={`${inputHeight} w-full rounded-sm border border-input bg-background px-3 text-xs font-mono`}
              />
              <button
                type="button"
                className={inputBtnClass(`slot_w_${idx}`)}
                onClick={() => setActiveField(`slot_w_${idx}`)}
              >
                Width: {slot.widthMm || '—'} mm
              </button>
            </div>
          </div>
        ))
      )}
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
          <dt className="text-muted-foreground">Slit No</dt>
          <dd className="font-mono text-xs">{slitNo || '—'}</dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Output Wt</dt>
          <dd className="font-mono">{form.values.outputWtMt || '—'} MT</dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Width</dt>
          <dd className="font-mono text-xs">
            {form.values.actualWidthMm || form.values.coilWidthMm || '—'} mm
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Slots</dt>
          <dd className="font-mono">{slitSlots.length}</dd>
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
        { id: 'quality', label: 'Quality', content: qualityTab },
        { id: 'slots', label: 'Slots', content: slotsTab },
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
