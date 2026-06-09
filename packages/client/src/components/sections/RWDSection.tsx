/**
 * RWDSection — Rewind process section (Wave 2 capture workspace).
 */

import { useEffect } from 'react';
import { useEntryForm } from '../../hooks/useEntryForm';
import { useNumericCapture } from '../../hooks/useNumericCapture';
import { autoSourceService } from '../../services/autoSourceService';
import { SingleTabCaptureShell } from '../capture/ProcessCaptureShell';
import { ZBadge } from '../primitives/ZBadge';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import type { ProcessSectionProps } from '../../lib/processSectionRegistry';
import type { RWDEntry } from '@m1/shared-validation';

type RWDFormValues = Omit<RWDEntry, 'id' | 'createdAt' | 'updatedAt'> & { id: string };

const FIELD_LABELS: Record<string, string> = {
  widthMm: 'Width',
  thkMm: 'Input thk',
  outputThkMm: 'Output thk',
  weightMt: 'Weight',
  rwTension1Kg: 'Tension 1',
  rwTension2Kg: 'Tension 2',
  rwTension3Kg: 'Tension 3',
};

function buildInitialValues(): RWDFormValues {
  return {
    id: crypto.randomUUID(),
    shiftLogId: '',
    coilNo: '',
    widthMm: 0,
    thkMm: 0,
    outputThkMm: 0,
    weightMt: 0,
    rwTension1Kg: undefined,
    rwTension2Kg: undefined,
    rwTension3Kg: undefined,
    surfaceFinish: '',
    timeFrom: undefined,
    timeTo: undefined,
    remarks: undefined,
    slNo: undefined,
  };
}

export function RWDSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const { values, setValue, isDirty, errors, saveStatus, save } = useEntryForm<RWDFormValues>({
    processCode,
    initialValues: buildInitialValues(),
  });

  const capture = useNumericCapture<RWDFormValues>({
    values,
    setValue: (field, value) => setValue(field as keyof RWDFormValues, value as RWDFormValues[keyof RWDFormValues]),
    fieldLabels: FIELD_LABELS,
    setValueForField: (field, raw) => {
      const n = parseFloat(raw);
      setValue(field as keyof RWDFormValues, raw === '' ? 0 : isNaN(n) ? undefined : n);
    },
  });

  useEffect(() => {
    if (!initialCoilNo) return;
    setValue('coilNo', initialCoilNo);
    autoSourceService.getPrefilledFields('RWD', initialCoilNo).then(({ fields }) => {
      for (const [field, pf] of Object.entries(fields)) {
        setValue(field as keyof RWDFormValues, pf.value);
      }
    }).catch(() => {});
  }, [initialCoilNo, setValue]);

  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;

  const form = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <div className="md:col-span-2">
        <ZInput label="Coil number" value={values.coilNo} onChange={(e) => setValue('coilNo', e.target.value)} error={fieldError('coilNo')} />
      </div>
      {(['widthMm', 'thkMm', 'outputThkMm', 'weightMt'] as const).map((f) => (
        <FieldWrapper key={f} label={FIELD_LABELS[f]} error={fieldError(f)}>
          <button type="button" className={capture.fieldBtnClass(f)} onClick={() => capture.setActiveField(f)}>
            {capture.getNumericValue(f) || '—'}
          </button>
        </FieldWrapper>
      ))}
      {(['rwTension1Kg', 'rwTension2Kg', 'rwTension3Kg'] as const).map((f) => (
        <FieldWrapper key={f} label={FIELD_LABELS[f]}>
          <button type="button" className={capture.fieldBtnClass(f)} onClick={() => capture.setActiveField(f)}>
            {capture.getNumericValue(f) || '—'}
          </button>
        </FieldWrapper>
      ))}
      <FieldWrapper label="Surface finish">
        <input
          value={values.surfaceFinish}
          onChange={(e) => setValue('surfaceFinish', e.target.value)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
        />
      </FieldWrapper>
    </div>
  );

  const summary = (
    <div className="p-4 text-sm">
      <span className="z-rail-label">Summary</span>
      <p className="font-mono text-xs mt-2">{values.coilNo || '—'}</p>
      <p className="font-mono text-xs text-muted-foreground mt-1">
        {capture.getNumericValue('outputThkMm') || capture.getNumericValue('thkMm') || '—'} mm
      </p>
    </div>
  );

  return (
    <SingleTabCaptureShell
      tabLabel="Rewind"
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
      statusExtras={initialCoilNo ? <ZBadge tone="info" label="Coil loaded" /> : null}
    >
      {form}
    </SingleTabCaptureShell>
  );
}
