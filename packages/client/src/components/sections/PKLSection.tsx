/**
 * PKLSection — Pickling process section (Wave 2 capture workspace).
 */

import { useState, useEffect } from 'react';
import { useEntryForm } from '../../hooks/useEntryForm';
import { useNumericCapture } from '../../hooks/useNumericCapture';
import { autoSourceService } from '../../services/autoSourceService';
import { ProcessCaptureShell } from '../capture/ProcessCaptureShell';
import { ZBadge } from '../primitives/ZBadge';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import type { ProcessSectionProps } from '../../lib/processSectionRegistry';
import type { PKLEntry } from '@m1/shared-validation';

type PKLFormValues = Omit<PKLEntry, 'id' | 'createdAt' | 'updatedAt'> & { id: string };

const FIELD_LABELS: Record<string, string> = {
  widthMm: 'Width',
  thkMm: 'Thickness',
  weightMt: 'Weight',
  lineSpeedMpm: 'Speed',
};

function buildInitialValues(): PKLFormValues {
  return {
    id: crypto.randomUUID(),
    shiftLogId: '',
    coilNo: '',
    widthMm: 0,
    thkMm: 0,
    weightMt: 0,
    lineSpeedMpm: 0,
    heatNo: '',
    source: '',
    wip: undefined,
    leaderEnd: undefined,
    timeFrom: undefined,
    timeTo: undefined,
    remarks: undefined,
    slNo: undefined,
  };
}

export function PKLSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const [activeTab, setActiveTab] = useState('coil');
  const [autoSourcedFields, setAutoSourcedFields] = useState<Set<string>>(new Set());

  const { values, setValue, isDirty, errors, saveStatus, save, reset } = useEntryForm<PKLFormValues>({
    processCode,
    initialValues: buildInitialValues(),
  });

  const capture = useNumericCapture<PKLFormValues>({
    values,
    setValue: (field, value) => setValue(field as keyof PKLFormValues, value as PKLFormValues[keyof PKLFormValues]),
    fieldLabels: FIELD_LABELS,
    autoSourcedFields,
    setValueForField: (field, raw) => {
      const n = parseFloat(raw);
      setValue(field as keyof PKLFormValues, raw === '' ? 0 : isNaN(n) ? undefined : n);
    },
  });

  useEffect(() => {
    if (!initialCoilNo) return;
    setValue('coilNo', initialCoilNo);
    autoSourceService
      .getPrefilledFields('PKL', initialCoilNo)
      .then(({ fields }) => {
        const sourced = new Set<string>();
        for (const [field, pf] of Object.entries(fields)) {
          setValue(field as keyof PKLFormValues, pf.value);
          sourced.add(field);
        }
        setAutoSourcedFields(sourced);
      })
      .catch(() => {});
  }, [initialCoilNo, setValue]);

  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;

  const coilTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <div className="md:col-span-2">
        <ZInput
          label="Coil number"
          value={values.coilNo}
          onChange={(e) => setValue('coilNo', e.target.value)}
          error={fieldError('coilNo')}
        />
      </div>
      <FieldWrapper label="Width (mm)" error={fieldError('widthMm')}>
        <button type="button" className={capture.fieldBtnClass('widthMm')} onClick={() => capture.setActiveField('widthMm')}>
          {capture.getNumericValue('widthMm') || '—'}
        </button>
      </FieldWrapper>
      <FieldWrapper label="Thickness (mm)" error={fieldError('thkMm')}>
        <button type="button" className={capture.fieldBtnClass('thkMm')} onClick={() => capture.setActiveField('thkMm')}>
          {capture.getNumericValue('thkMm') || '—'}
        </button>
      </FieldWrapper>
      <FieldWrapper label="Weight (MT)" error={fieldError('weightMt')}>
        <button type="button" className={capture.fieldBtnClass('weightMt')} onClick={() => capture.setActiveField('weightMt')}>
          {capture.getNumericValue('weightMt') || '—'}
        </button>
      </FieldWrapper>
      <FieldWrapper label="Line speed (mpm)" error={fieldError('lineSpeedMpm')}>
        <button type="button" className={capture.fieldBtnClass('lineSpeedMpm')} onClick={() => capture.setActiveField('lineSpeedMpm')}>
          {capture.getNumericValue('lineSpeedMpm') || '—'}
        </button>
      </FieldWrapper>
      <FieldWrapper label="Heat no" error={fieldError('heatNo')}>
        <input
          value={values.heatNo}
          onChange={(e) => setValue('heatNo', e.target.value)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
        />
      </FieldWrapper>
      <FieldWrapper label="Source" error={fieldError('source')}>
        <input
          value={values.source}
          onChange={(e) => setValue('source', e.target.value)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
        />
      </FieldWrapper>
    </div>
  );

  const runTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <FieldWrapper label="WIP status">
        <input
          value={values.wip ?? ''}
          onChange={(e) => setValue('wip', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
        />
      </FieldWrapper>
      <FieldWrapper label="Leader end">
        <input
          value={values.leaderEnd ?? ''}
          onChange={(e) => setValue('leaderEnd', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
        />
      </FieldWrapper>
      <FieldWrapper label="Time from" error={fieldError('timeFrom')}>
        <input
          type="time"
          value={values.timeFrom ?? ''}
          onChange={(e) => setValue('timeFrom', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
        />
      </FieldWrapper>
      <FieldWrapper label="Time to" error={fieldError('timeTo')}>
        <input
          type="time"
          value={values.timeTo ?? ''}
          onChange={(e) => setValue('timeTo', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
        />
      </FieldWrapper>
    </div>
  );

  const summary = (
    <div className="p-4 flex flex-col gap-3 text-sm">
      <span className="z-rail-label">Live summary</span>
      <dl className="flex flex-col gap-2">
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Coil</dt>
          <dd className="font-mono text-xs">{values.coilNo || '—'}</dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Dims</dt>
          <dd className="font-mono text-xs">
            {capture.getNumericValue('thkMm') || '—'}×{capture.getNumericValue('widthMm') || '—'} mm
          </dd>
        </div>
        <div className="flex justify-between border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">Weight</dt>
          <dd className="font-mono">{capture.getNumericValue('weightMt') || '—'} MT</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Speed</dt>
          <dd className="font-mono">{capture.getNumericValue('lineSpeedMpm') || '—'} mpm</dd>
        </div>
      </dl>
    </div>
  );

  return (
    <ProcessCaptureShell
      tabs={[
        { id: 'coil', label: 'Coil', content: coilTab },
        { id: 'run', label: 'Run', content: runTab },
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      summary={summary}
      values={values}
      errors={errors}
      isDirty={isDirty}
      saveStatus={saveStatus}
      onSave={() => save()}
      activeField={capture.activeField}
      activeFieldLabel={capture.activeFieldLabel}
      getNumericValue={capture.getNumericValue}
      setNumericValue={capture.setNumericValue}
      statusExtras={autoSourcedFields.size > 0 ? <ZBadge tone="info" label="Auto-filled" /> : null}
      footerExtras={
        isDirty ? (
          <ZButton variant="ghost" fullWidth size="sm" onClick={reset}>
            Reset
          </ZButton>
        ) : null
      }
    />
  );
}
