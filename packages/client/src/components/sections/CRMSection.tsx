/**
 * CRMSection — Cold Rolling Mill (Wave 2 capture workspace).
 */

import { useEffect, useState } from 'react';
import { useEntryForm } from '../../hooks/useEntryForm';
import { useNumericCapture } from '../../hooks/useNumericCapture';
import { autoSourceService } from '../../services/autoSourceService';
import { ProcessCaptureShell } from '../capture/ProcessCaptureShell';
import { ZBadge } from '../primitives/ZBadge';
import { ZButton } from '../primitives/ZButton';
import { FieldWrapper } from '../forms/FieldWrapper';
import type { ProcessSectionProps } from '../../lib/processSectionRegistry';
import type { CRMEntry } from '@m1/shared-validation';

type CRMFormValues = Omit<CRMEntry, 'id' | 'createdAt' | 'updatedAt'> & { id: string };

const FIELD_LABELS: Record<string, string> = {
  widthMm: 'Width',
  inputThkMm: 'Input thk',
  outputThkMm: 'Output thk',
  weightMt: 'Weight',
  annHardness: 'Ann hardness',
  hardnessVpn: 'VPN',
  hardnessHrb: 'HRB',
  elongationPct: 'Elongation',
  scrapMt: 'Scrap',
  lossPct: 'Loss',
  stretchPct: 'Stretch',
  oilLevelInitial: 'Oil init',
  oilLevelFinal: 'Oil final',
  oilConsumption: 'Oil use',
  rwTensionKg: 'RW tension',
  tkgWeightMt: 'TKG wt',
};

function buildInitialValues(): CRMFormValues {
  return {
    id: '',
    shiftLogId: '',
    coilNo: '',
    widthMm: 0,
    inputThkMm: 0,
    outputThkMm: 0,
    weightMt: 0,
    annHardness: undefined,
    hardnessVpn: undefined,
    hardnessHrb: undefined,
    rollIn: undefined,
    rollOut: undefined,
    oilLevelInitial: undefined,
    oilLevelFinal: undefined,
    oilConsumption: undefined,
    rwTensionKg: undefined,
    tkgWeightMt: undefined,
    elongationPct: undefined,
    lossPct: undefined,
    stretchPct: undefined,
    scrapMt: undefined,
    timeFrom: undefined,
    timeTo: undefined,
    remarks: undefined,
    slNo: undefined,
  };
}

export function CRMSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const [activeTab, setActiveTab] = useState('pass');
  const [millType, setMillType] = useState<'2HI' | '4HI' | '6HI'>('4HI');
  const [autoSourcedFields, setAutoSourcedFields] = useState<Set<string>>(new Set());

  const { values, setValue, isDirty, errors, saveStatus, save, reset } = useEntryForm<CRMFormValues>({
    processCode,
    initialValues: buildInitialValues(),
  });

  const capture = useNumericCapture<CRMFormValues>({
    values,
    setValue: (field, value) => setValue(field as keyof CRMFormValues, value as CRMFormValues[keyof CRMFormValues]),
    fieldLabels: FIELD_LABELS,
    autoSourcedFields,
    setValueForField: (field, raw) => {
      const n = parseFloat(raw);
      setValue(field as keyof CRMFormValues, raw === '' ? 0 : isNaN(n) ? undefined : n);
    },
  });

  useEffect(() => {
    if (!initialCoilNo) return;
    setValue('coilNo', initialCoilNo);
    autoSourceService.getPrefilledFields('CRM', initialCoilNo).then(({ fields }) => {
      const sourced = new Set<string>();
      for (const [field, pf] of Object.entries(fields)) {
        setValue(field as keyof CRMFormValues, pf.value);
        sourced.add(field);
      }
      setAutoSourcedFields(sourced);
    }).catch(() => {});
  }, [initialCoilNo, setValue]);

  const hasThicknessError =
    values.outputThkMm > 0 && values.inputThkMm > 0 && values.outputThkMm >= values.inputThkMm;
  const hasOilLevelError =
    millType === '2HI' &&
    values.oilLevelInitial !== undefined &&
    values.oilLevelFinal !== undefined &&
    values.oilLevelFinal > values.oilLevelInitial;

  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;
  const numBtn = (field: string, hasError = false) => (
    <button type="button" className={capture.fieldBtnClass(field, hasError)} onClick={() => capture.setActiveField(field)}>
      {capture.getNumericValue(field) || '—'}
    </button>
  );

  const millSelector = (
    <div className="flex gap-0.5 border border-border rounded-sm p-0.5 mb-4 w-fit">
      {(['2HI', '4HI', '6HI'] as const).map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => setMillType(type)}
          className={[
            'px-4 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors',
            millType === type ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          {type}
        </button>
      ))}
    </div>
  );

  const passTab = (
    <div className="max-w-3xl flex flex-col gap-4">
      {millSelector}
      <input
        placeholder="Coil number"
        value={values.coilNo}
        onChange={(e) => setValue('coilNo', e.target.value)}
        className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
      />
      <FieldWrapper label="Width (mm)" error={fieldError('widthMm')}>{numBtn('widthMm')}</FieldWrapper>
      <div className={`flex ${capture.controlGap}`}>
        <FieldWrapper label="Input thk (mm)" error={fieldError('inputThkMm')}>{numBtn('inputThkMm')}</FieldWrapper>
        <FieldWrapper label="Output thk (mm)" error={fieldError('outputThkMm') || (hasThicknessError ? 'Must be < input' : undefined)}>
          {numBtn('outputThkMm', hasThicknessError)}
        </FieldWrapper>
      </div>
      {hasThicknessError && <ZBadge tone="destructive" label="Output < input required" />}
      <FieldWrapper label="Weight (MT)" error={fieldError('weightMt')}>{numBtn('weightMt')}</FieldWrapper>
      <div className={`flex ${capture.controlGap}`}>
        <FieldWrapper label="Time from">
          <input type="time" value={values.timeFrom ?? ''} onChange={(e) => setValue('timeFrom', e.target.value || undefined)}
            className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
        </FieldWrapper>
        <FieldWrapper label="Time to">
          <input type="time" value={values.timeTo ?? ''} onChange={(e) => setValue('timeTo', e.target.value || undefined)}
            className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
        </FieldWrapper>
      </div>
    </div>
  );

  const qualityTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <FieldWrapper label="Ann hardness">{numBtn('annHardness')}</FieldWrapper>
      <FieldWrapper label="Hardness VPN">{numBtn('hardnessVpn')}</FieldWrapper>
      <FieldWrapper label="Hardness HRB">{numBtn('hardnessHrb')}</FieldWrapper>
      <FieldWrapper label="Elongation %">{numBtn('elongationPct')}</FieldWrapper>
      <FieldWrapper label="Scrap (MT)">{numBtn('scrapMt')}</FieldWrapper>
      {millType === '2HI' && (
        <>
          <FieldWrapper label="Loss %">{numBtn('lossPct')}</FieldWrapper>
          <FieldWrapper label="Stretch %">{numBtn('stretchPct')}</FieldWrapper>
        </>
      )}
      <FieldWrapper label="Roll in">
        <input value={values.rollIn ?? ''} onChange={(e) => setValue('rollIn', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
      </FieldWrapper>
      <FieldWrapper label="Roll out">
        <input value={values.rollOut ?? ''} onChange={(e) => setValue('rollOut', e.target.value || undefined)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
      </FieldWrapper>
    </div>
  );

  const oilTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      {millType === '2HI' && (
        <>
          <FieldWrapper label="Oil level initial" error={hasOilLevelError ? 'Final > initial' : undefined}>
            {numBtn('oilLevelInitial', hasOilLevelError)}
          </FieldWrapper>
          <FieldWrapper label="Oil level final">{numBtn('oilLevelFinal', hasOilLevelError)}</FieldWrapper>
          {hasOilLevelError && <ZBadge tone="destructive" label="Oil level invalid" />}
          <FieldWrapper label="Oil consumption">{numBtn('oilConsumption')}</FieldWrapper>
        </>
      )}
      <FieldWrapper label="RW tension (kg)">{numBtn('rwTensionKg')}</FieldWrapper>
      <FieldWrapper label="TKG weight (MT)">{numBtn('tkgWeightMt')}</FieldWrapper>
    </div>
  );

  const summary = (
    <div className="p-4 text-sm">
      <span className="z-rail-label">Pass summary</span>
      <p className="font-mono text-xs mt-2">{values.coilNo || '—'}</p>
      <p className="font-mono text-xs text-muted-foreground mt-1">
        {capture.getNumericValue('inputThkMm') || '—'} → {capture.getNumericValue('outputThkMm') || '—'} mm
      </p>
      <p className="font-mono text-xs text-muted-foreground">{millType} · {capture.getNumericValue('weightMt') || '—'} MT</p>
    </div>
  );

  return (
    <ProcessCaptureShell
      tabs={[
        { id: 'pass', label: 'Pass', content: passTab },
        { id: 'quality', label: 'Quality', content: qualityTab },
        { id: 'oil', label: 'Oil', content: oilTab },
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
      statusExtras={
        <>
          <ZBadge tone="muted" label={millType} />
          {autoSourcedFields.size > 0 && <ZBadge tone="info" label="Auto-filled" />}
        </>
      }
      footerExtras={
        isDirty ? (
          <ZButton variant="ghost" fullWidth size="sm" onClick={reset}>Reset</ZButton>
        ) : null
      }
    />
  );
}
