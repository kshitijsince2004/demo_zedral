/**
 * CTLSection — Cut-to-Length (Wave 2 capture workspace).
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
import { kgToMt } from '@m1/shared-validation';
import type { ProcessSectionProps } from '../../lib/processSectionRegistry';
import type { CTLEntry } from '@m1/shared-validation';

type CTLFormValues = Omit<CTLEntry, 'id' | 'createdAt' | 'updatedAt'> & { id: string };

const FIELD_LABELS: Record<string, string> = {
  widthMm: 'Width',
  thkMm: 'Thickness',
  weightMt: 'Weight',
  nominalSetLengthMm: 'Nom length',
  actualLengthMm: 'Act length',
  noPieces: 'Pieces',
  noBundles: 'Bundles',
  totalProdMt: 'Total prod',
  holdMt: 'Hold',
  rejectionMt: 'Rejection',
};

function buildInitialValues(): CTLFormValues {
  return {
    id: '',
    shiftLogId: '',
    coilNo: '',
    widthMm: 0,
    thkMm: 0,
    weightMt: 0,
    nominalSetLengthMm: 0,
    actualLengthMm: 0,
    noPieces: 0,
    noBundles: 0,
    totalProdMt: 0,
    holdMt: undefined,
    rejectionMt: undefined,
    lowSpeed: undefined,
    estimatedSuppressed: undefined,
    timeFrom: undefined,
    timeTo: undefined,
    remarks: undefined,
    slNo: undefined,
  };
}

export function CTLSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const [activeTab, setActiveTab] = useState('dims');
  const [autoSourcedFields, setAutoSourcedFields] = useState<Set<string>>(new Set());
  const [weightKg, setWeightKg] = useState('');
  const [showSquarenessPrompt, setShowSquarenessPrompt] = useState(false);
  const [lastPromptedPieces, setLastPromptedPieces] = useState(0);

  const { values, setValue, isDirty, errors, saveStatus, save, reset } = useEntryForm<CTLFormValues>({
    processCode,
    initialValues: buildInitialValues(),
  });

  const capture = useNumericCapture<CTLFormValues>({
    values,
    setValue: (field, value) => setValue(field as keyof CTLFormValues, value as CTLFormValues[keyof CTLFormValues]),
    fieldLabels: FIELD_LABELS,
    autoSourcedFields,
    setValueForField: (field, raw) => {
      const n = parseFloat(raw);
      setValue(field as keyof CTLFormValues, raw === '' ? 0 : isNaN(n) ? undefined : n);
    },
  });

  useEffect(() => {
    if (!initialCoilNo) return;
    setValue('coilNo', initialCoilNo);
    autoSourceService.getPrefilledFields('CTL', initialCoilNo).then(({ fields }) => {
      const sourced = new Set<string>();
      for (const [field, pf] of Object.entries(fields)) {
        setValue(field as keyof CTLFormValues, pf.value);
        sourced.add(field);
      }
      setAutoSourcedFields(sourced);
    }).catch(() => {});
  }, [initialCoilNo, setValue]);

  useEffect(() => {
    const pieces = values.noPieces || 0;
    if (pieces > 0 && pieces % 50 === 0 && pieces !== lastPromptedPieces) {
      setShowSquarenessPrompt(true);
      setLastPromptedPieces(pieces);
    }
  }, [values.noPieces, lastPromptedPieces]);

  const handleWeightKgBlur = () => {
    const kg = parseFloat(weightKg);
    if (!isNaN(kg)) setValue('weightMt', kgToMt(kg));
  };

  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;
  const numBtn = (field: string) => (
    <button type="button" className={capture.fieldBtnClass(field)} onClick={() => capture.setActiveField(field)}>
      {capture.getNumericValue(field) || '—'}
    </button>
  );

  const dimsTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <div className="md:col-span-2">
        <ZInput label="Coil number" value={values.coilNo} onChange={(e) => setValue('coilNo', e.target.value)} error={fieldError('coilNo')} />
      </div>
      <FieldWrapper label="Width (mm)" error={fieldError('widthMm')}>{numBtn('widthMm')}</FieldWrapper>
      <FieldWrapper label="Thickness (mm)" error={fieldError('thkMm')}>{numBtn('thkMm')}</FieldWrapper>
      <FieldWrapper label="Weight (kg → MT)" error={fieldError('weightMt')}>
        <div className="flex flex-col gap-1">
          <input
            type="number"
            placeholder="kg"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            onBlur={handleWeightKgBlur}
            className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
          />
          {values.weightMt > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">= {values.weightMt.toFixed(4)} MT</span>
          )}
        </div>
      </FieldWrapper>
      <FieldWrapper label="Nom set length (mm)" error={fieldError('nominalSetLengthMm')}>{numBtn('nominalSetLengthMm')}</FieldWrapper>
      <FieldWrapper label="Actual length (mm)" error={fieldError('actualLengthMm')}>{numBtn('actualLengthMm')}</FieldWrapper>
    </div>
  );

  const countsTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <FieldWrapper label="No of pieces" error={fieldError('noPieces')}>{numBtn('noPieces')}</FieldWrapper>
      <FieldWrapper label="No of bundles" error={fieldError('noBundles')}>{numBtn('noBundles')}</FieldWrapper>
      <FieldWrapper label="Total production (MT)" error={fieldError('totalProdMt')}>{numBtn('totalProdMt')}</FieldWrapper>
      <FieldWrapper label="Hold MT">{numBtn('holdMt')}</FieldWrapper>
      <FieldWrapper label="Rejection MT">{numBtn('rejectionMt')}</FieldWrapper>
      <FieldWrapper label="Low speed">
        <input value={values.lowSpeed ?? ''} onChange={(e) => setValue('lowSpeed', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
      </FieldWrapper>
      <FieldWrapper label="Time from" error={fieldError('timeFrom')}>
        <input type="time" value={values.timeFrom ?? ''} onChange={(e) => setValue('timeFrom', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
      </FieldWrapper>
      <FieldWrapper label="Time to" error={fieldError('timeTo')}>
        <input type="time" value={values.timeTo ?? ''} onChange={(e) => setValue('timeTo', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
      </FieldWrapper>
    </div>
  );

  const summary = (
    <div className="p-4 text-sm">
      <span className="z-rail-label">CTL summary</span>
      <p className="font-mono text-xs mt-2">{values.coilNo || '—'}</p>
      <p className="font-mono text-xs text-muted-foreground mt-1">{values.noPieces || 0} pcs · {values.noBundles || 0} bdl</p>
    </div>
  );

  return (
    <>
      <ProcessCaptureShell
        tabs={[
          { id: 'dims', label: 'Dims', content: dimsTab },
          { id: 'counts', label: 'Counts', content: countsTab },
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
        footerExtras={isDirty ? <ZButton variant="ghost" fullWidth size="sm" onClick={reset}>Reset</ZButton> : null}
      />

      {showSquarenessPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4">
          <div className="border border-warning/40 bg-card rounded-sm w-full max-w-sm p-5 flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-warning">Squareness check required</h3>
            <p className="text-sm text-muted-foreground">
              {values.noPieces} pieces reached — perform squareness and length check per SOP.
            </p>
            <ZButton variant="accent" fullWidth onClick={() => setShowSquarenessPrompt(false)}>
              Acknowledge
            </ZButton>
          </div>
        </div>
      )}
    </>
  );
}
