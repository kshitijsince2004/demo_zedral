/**
 * HRSSection — HR Slitting process section (Wave 1 capture workspace).
 *
 * Same business logic as before: useEntryForm, auto-source, slit slots, validation.
 * Layout: tabbed coil/slots form + live summary + docked keypad.
 */

import { useState, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useEntryForm } from '../../hooks/useEntryForm';
import { autoSourceService } from '../../services/autoSourceService';
import { CaptureWorkspace } from '../capture/CaptureWorkspace';
import { ZKeypad } from '../primitives/ZKeypad';
import { ZBadge } from '../primitives/ZBadge';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { ReviewSubmitGate } from '../forms/ReviewSubmitGate';
import { FieldWrapper } from '../forms/FieldWrapper';
import { useGloveModeClasses } from '../../hooks/useGloveModeClasses';
import type { ProcessSectionProps } from '../../lib/processSectionRegistry';
import type { HRSEntry, HRSSlitSlot } from '@m1/shared-validation';

type HRSFormValues = Omit<HRSEntry, 'id' | 'shiftLogId' | 'createdAt' | 'updatedAt'> & {
  id: string;
  shiftLogId: string;
};

const initialValues: HRSFormValues = {
  id: '',
  shiftLogId: '',
  coilNo: '',
  nominalWidthMm: 0,
  actualWidthMm: 0,
  nominalThkMm: 0,
  weightMt: 0,
  scrapMt: 0,
  actualSlitWidthFromMm: undefined,
  actualSlitWidthToMm: undefined,
  timeFrom: undefined,
  timeTo: undefined,
  remarks: undefined,
  slNo: undefined,
  slitSlots: [],
};

interface SlitSlotDraft {
  label: 'A' | 'B' | 'C' | 'D';
  widthMm: string;
  thkMm: string;
  taper: string;
  childCoilNo: string;
}

const SLOT_LABELS: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

const FIELD_LABELS: Record<string, string> = {
  nominalWidthMm: 'Nom width',
  actualWidthMm: 'Act width',
  nominalThkMm: 'Thickness',
  weightMt: 'Weight',
  scrapMt: 'Scrap',
  actualSlitWidthFromMm: 'Slit from',
  actualSlitWidthToMm: 'Slit to',
};

export function HRSSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const { inputHeight, inputPadding, controlGap } = useGloveModeClasses();

  const form = useEntryForm({
    processCode,
    initialValues: { ...initialValues, id: crypto.randomUUID() },
  });

  const [coilNo, setCoilNo] = useState(initialCoilNo ?? '');
  const [autoSourceStatus, setAutoSourceStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [slitSlots, setSlitSlots] = useState<SlitSlotDraft[]>([]);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('coil');

  const handleCoilBlur = useCallback(async () => {
    if (!coilNo.trim()) return;
    setAutoSourceStatus('loading');
    try {
      const prefilled = await autoSourceService.getPrefilledFields('HRS', coilNo.trim());
      const fields = prefilled.fields;
      if (fields.nominalWidthMm) form.setValue('nominalWidthMm', fields.nominalWidthMm.value);
      if (fields.nominalThkMm) form.setValue('nominalThkMm', fields.nominalThkMm.value);
      if (fields.weightMt) form.setValue('weightMt', fields.weightMt.value);
      form.setValue('coilNo', coilNo.trim());
      setAutoSourceStatus('done');
    } catch {
      setAutoSourceStatus('error');
      form.setValue('coilNo', coilNo.trim());
    }
  }, [coilNo, form]);

  const handleAddSlot = () => {
    if (slitSlots.length >= 4) return;
    const label = SLOT_LABELS[slitSlots.length];
    setSlitSlots((prev) => [...prev, { label, widthMm: '', thkMm: '', taper: '', childCoilNo: '' }]);
  };

  const handleRemoveSlot = (idx: number) => {
    setSlitSlots((prev) => prev.filter((_, i) => i !== idx));
  };

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
    if (field.startsWith('slot_t_')) {
      const idx = parseInt(field.replace('slot_t_', ''), 10);
      return slitSlots[idx]?.thkMm ?? '';
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
    if (field.startsWith('slot_t_')) {
      const idx = parseInt(field.replace('slot_t_', ''), 10);
      updateSlot(idx, 'thkMm', val);
      return;
    }
    form.setValue(field as keyof typeof form.values, val === '' ? 0 : parseFloat(val));
  };

  const handleSave = async () => {
    const parsedSlots: HRSSlitSlot[] = slitSlots
      .filter((s) => s.widthMm !== '')
      .map((s) => ({
        label: s.label,
        widthMm: parseFloat(s.widthMm) || 0,
        thkMm: s.thkMm ? parseFloat(s.thkMm) : undefined,
        taper: s.taper || undefined,
        childCoilNo: s.childCoilNo || undefined,
      }));
    form.setValue('slitSlots', parsedSlots);
    form.setValue('coilNo', coilNo.trim());
    return form.save();
  };

  const weightMt = Number(form.values.weightMt) || 0;
  const scrapMt = Number(form.values.scrapMt) || 0;
  const scrapPct = weightMt > 0 ? ((scrapMt / weightMt) * 100).toFixed(2) : '0.00';
  const fieldError = (field: string) => form.errors.find((e) => e.field === field)?.message;

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

  const activeFieldLabel = activeField
    ? activeField.startsWith('slot_w_')
      ? `Slot ${slitSlots[parseInt(activeField.replace('slot_w_', ''), 10)]?.label} width`
      : activeField.startsWith('slot_t_')
        ? `Slot ${slitSlots[parseInt(activeField.replace('slot_t_', ''), 10)]?.label} thk`
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
          placeholder="C-2024-001"
          error={fieldError('coilNo')}
        />
      </div>

      <FieldWrapper label="Nom width (mm)" error={fieldError('nominalWidthMm')}>
        <button type="button" className={inputBtnClass('nominalWidthMm')} onClick={() => setActiveField('nominalWidthMm')}>
          {getNumericValue('nominalWidthMm') || '—'}
        </button>
      </FieldWrapper>
      <FieldWrapper label="Act width (mm)" error={fieldError('actualWidthMm')}>
        <button type="button" className={inputBtnClass('actualWidthMm')} onClick={() => setActiveField('actualWidthMm')}>
          {getNumericValue('actualWidthMm') || '—'}
        </button>
      </FieldWrapper>

      <FieldWrapper label="Nom thickness (mm)" error={fieldError('nominalThkMm')}>
        <button type="button" className={`${inputBtnClass('nominalThkMm')} w-full`} onClick={() => setActiveField('nominalThkMm')}>
          {getNumericValue('nominalThkMm') || '—'}
        </button>
      </FieldWrapper>

      <div className={`flex ${controlGap}`}>
        <FieldWrapper label="Weight (MT)" error={fieldError('weightMt')}>
          <button type="button" className={inputBtnClass('weightMt')} onClick={() => setActiveField('weightMt')}>
            {getNumericValue('weightMt') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Scrap (MT)" error={fieldError('scrapMt')}>
          <button type="button" className={inputBtnClass('scrapMt')} onClick={() => setActiveField('scrapMt')}>
            {getNumericValue('scrapMt') || '—'}
          </button>
        </FieldWrapper>
      </div>

      <div className={`flex ${controlGap} md:col-span-2`}>
        <FieldWrapper label="Slit width from (mm)" error={fieldError('actualSlitWidthFromMm')}>
          <button type="button" className={inputBtnClass('actualSlitWidthFromMm')} onClick={() => setActiveField('actualSlitWidthFromMm')}>
            {getNumericValue('actualSlitWidthFromMm') || '—'}
          </button>
        </FieldWrapper>
        <FieldWrapper label="Slit width to (mm)" error={fieldError('actualSlitWidthToMm')}>
          <button type="button" className={inputBtnClass('actualSlitWidthToMm')} onClick={() => setActiveField('actualSlitWidthToMm')}>
            {getNumericValue('actualSlitWidthToMm') || '—'}
          </button>
        </FieldWrapper>
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
              <input
                placeholder="Taper (optional)"
                value={slot.taper}
                onChange={(e) => updateSlot(idx, 'taper', e.target.value)}
                className={`${inputHeight} w-full rounded-sm border border-input bg-background px-3 text-xs font-mono`}
              />
              <div className={`flex ${controlGap}`}>
                <button type="button" className={inputBtnClass(`slot_w_${idx}`)} onClick={() => setActiveField(`slot_w_${idx}`)}>
                  W: {slot.widthMm || '—'}
                </button>
                <button type="button" className={inputBtnClass(`slot_t_${idx}`)} onClick={() => setActiveField(`slot_t_${idx}`)}>
                  T: {slot.thkMm || '—'}
                </button>
              </div>
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
          <dt className="text-muted-foreground">Weight</dt>
          <dd className="font-mono">{weightMt || '—'} MT</dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Scrap</dt>
          <dd className={`font-mono font-semibold ${Number(scrapPct) > 5 ? 'text-destructive' : 'text-success'}`}>
            {scrapPct}%
          </dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Width</dt>
          <dd className="font-mono text-xs">
            {getNumericValue('actualWidthMm') || getNumericValue('nominalWidthMm') || '—'} mm
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
