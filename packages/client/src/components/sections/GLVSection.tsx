/**
 * GLVSection — Galvanizing process section (Wave 6 capture workspace).
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

type GLVFormValues = {
  id: string;
  shiftLogId: string;
  coilNo: string;
  slNo?: number;
  timeFrom?: string;
  timeTo?: string;
  remarks?: string;
  zincCoatingGsm?: number;
  spangleType?: string;
  weightMt: number;
};

const FIELD_LABELS: Record<string, string> = {
  weightMt: 'Weight (MT)',
  zincCoatingGsm: 'Zinc coating (GSM)',
};

function buildInitialValues(): GLVFormValues {
  return {
    id: crypto.randomUUID(),
    shiftLogId: '',
    coilNo: '',
    weightMt: 0,
    zincCoatingGsm: undefined,
    spangleType: '',
    timeFrom: undefined,
    timeTo: undefined,
    remarks: undefined,
    slNo: undefined,
  };
}

export function GLVSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const { values, setValue, isDirty, errors, saveStatus, save } = useEntryForm<GLVFormValues>({
    processCode,
    initialValues: buildInitialValues(),
  });

  const capture = useNumericCapture<GLVFormValues>({
    values,
    setValue: (field, value) => setValue(field as keyof GLVFormValues, value as GLVFormValues[keyof GLVFormValues]),
    fieldLabels: FIELD_LABELS,
    setValueForField: (field, raw) => {
      const n = parseFloat(raw);
      setValue(field as keyof GLVFormValues, raw === '' ? 0 : isNaN(n) ? undefined : n);
    },
  });

  useEffect(() => {
    if (!initialCoilNo) return;
    setValue('coilNo', initialCoilNo);
    autoSourceService.getPrefilledFields('GLV', initialCoilNo).then(({ fields }) => {
      for (const [field, pf] of Object.entries(fields)) {
        setValue(field as keyof GLVFormValues, pf.value);
      }
    }).catch(() => {});
  }, [initialCoilNo, setValue]);

  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;

  const form = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <div className="md:col-span-2">
        <ZInput
          label="Coil number"
          value={values.coilNo}
          onChange={(e) => setValue('coilNo', e.target.value)}
          error={fieldError('coilNo')}
          placeholder="Scan or type coil"
        />
      </div>

      {(['weightMt', 'zincCoatingGsm'] as const).map((f) => (
        <FieldWrapper key={f} label={FIELD_LABELS[f]} error={fieldError(f)}>
          <button type="button" className={capture.fieldBtnClass(f)} onClick={() => capture.setActiveField(f)}>
            {capture.getNumericValue(f) || '—'}
          </button>
        </FieldWrapper>
      ))}

      <FieldWrapper label="Spangle type" error={fieldError('spangleType')}>
        <select
          value={values.spangleType ?? ''}
          onChange={(e) => setValue('spangleType', e.target.value)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm`}
        >
          <option value="">Select spangle…</option>
          <option value="REGULAR">Regular spangle</option>
          <option value="MINIMIZED">Minimized spangle</option>
          <option value="ZERO">Zero spangle</option>
        </select>
      </FieldWrapper>
    </div>
  );

  const summary = (
    <div className="p-4 text-sm">
      <span className="z-rail-label">Summary</span>
      <p className="font-mono text-xs mt-2">{values.coilNo || '—'}</p>
      <p className="font-mono text-xs text-muted-foreground mt-1">
        {capture.getNumericValue('weightMt') || '—'} MT
        {values.spangleType ? ` · ${values.spangleType}` : ''}
      </p>
    </div>
  );

  return (
    <SingleTabCaptureShell
      tabLabel="Galvanizing"
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
