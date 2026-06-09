/**
 * ANNSection — Annealing (Wave 2 capture workspace).
 */

import { useState, useEffect } from 'react';
import { useEntryForm } from '../../hooks/useEntryForm';
import { useNumericCapture } from '../../hooks/useNumericCapture';
import { useShiftStore } from '../../store/shiftStore';
import { ProcessCaptureShell } from '../capture/ProcessCaptureShell';
import { ZBadge } from '../primitives/ZBadge';
import { ZButton } from '../primitives/ZButton';
import { FieldWrapper } from '../forms/FieldWrapper';
import type { ProcessSectionProps } from '../../lib/processSectionRegistry';
import type { ANNEntry } from '@m1/shared-validation';

type ANNFormValues = Omit<ANNEntry, 'id' | 'createdAt' | 'updatedAt'> & { id: string };

const FIELD_LABELS: Record<string, string> = {
  furnaceId: 'Furnace',
  dewPointN2: 'DP N2',
  dewPointH2: 'DP H2',
  temperatureDegC: 'Temperature',
  loadingMt: 'Loading',
  unloadingMt: 'Unloading',
  cummLoadingMt: 'Cumm load',
  cummUnloadingMt: 'Cumm unload',
};

function buildInitialValues(): ANNFormValues {
  return {
    id: '',
    shiftLogId: '',
    coilNo: '',
    chargeNo: '',
    baseNo: '',
    furnaceId: 0,
    gradeCode: '',
    noOfCoils: 0,
    status: undefined,
    dewPointN2: undefined,
    dewPointH2: undefined,
    temperatureDegC: undefined,
    expUnloadingTime: undefined,
    unloadingWtMt: undefined,
    loadingMt: undefined,
    unloadingMt: undefined,
    cummLoadingMt: undefined,
    cummUnloadingMt: undefined,
    timeFrom: undefined,
    timeTo: undefined,
    remarks: undefined,
    slNo: undefined,
  };
}

export function ANNSection({ processCode, coilNo: initialCoilNo }: ProcessSectionProps) {
  const [activeTab, setActiveTab] = useState('charge');
  const { plannedCoils } = useShiftStore();
  const annCoils = plannedCoils.filter((c) => c.processLine === 'ANN');
  const [selectedCoilIds, setSelectedCoilIds] = useState<string[]>([]);

  const { values, setValue, isDirty, errors, saveStatus, save, reset } = useEntryForm<ANNFormValues>({
    processCode,
    initialValues: buildInitialValues(),
  });

  const capture = useNumericCapture<ANNFormValues>({
    values,
    setValue: (field, value) => setValue(field as keyof ANNFormValues, value as ANNFormValues[keyof ANNFormValues]),
    fieldLabels: FIELD_LABELS,
    setValueForField: (field, raw) => {
      const n = parseFloat(raw);
      setValue(field as keyof ANNFormValues, raw === '' ? 0 : isNaN(n) ? undefined : n);
    },
  });

  useEffect(() => {
    if (!initialCoilNo) return;
    const coil = annCoils.find((c) => c.coilNo === initialCoilNo);
    if (coil && !selectedCoilIds.includes(coil.id)) {
      setSelectedCoilIds((prev) => [...prev, coil.id]);
    }
  }, [initialCoilNo, annCoils, selectedCoilIds]);

  useEffect(() => {
    const selected = annCoils.filter((c) => selectedCoilIds.includes(c.id));
    setValue('noOfCoils', selected.length);
    setValue('coilNo', selected.map((c) => c.coilNo).join(', '));
  }, [selectedCoilIds, annCoils, setValue]);

  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;
  const numBtn = (field: string) => (
    <button type="button" className={capture.fieldBtnClass(field)} onClick={() => capture.setActiveField(field)}>
      {capture.getNumericValue(field) || '—'}
    </button>
  );

  const selectedWeight = annCoils
    .filter((c) => selectedCoilIds.includes(c.id))
    .reduce((sum, c) => sum + c.weightMt, 0);

  const chargeTab = (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="border border-border rounded-sm p-3">
        <div className="flex justify-between items-center mb-2">
          <span className="z-rail-label">Charge builder</span>
          <span className="font-mono text-xs text-muted-foreground">
            {selectedCoilIds.length} coils · {selectedWeight.toFixed(3)} MT
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {annCoils.length > 0 ? (
            annCoils.map((coil) => {
              const isSelected = selectedCoilIds.includes(coil.id);
              return (
                <button
                  key={coil.id}
                  type="button"
                  onClick={() =>
                    setSelectedCoilIds((prev) =>
                      isSelected ? prev.filter((id) => id !== coil.id) : [...prev, coil.id],
                    )
                  }
                  className={[
                    'px-3 py-2 rounded-sm border text-left transition-colors',
                    isSelected
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border hover:border-accent/30',
                  ].join(' ')}
                >
                  <span className="text-sm font-mono font-semibold block">{coil.coilNo}</span>
                  <span className="text-[10px] text-muted-foreground">{coil.weightMt} MT</span>
                </button>
              );
            })
          ) : (
            <span className="text-sm text-muted-foreground">No planned ANN coils in queue</span>
          )}
        </div>
        {fieldError('coilNo') && <p className="text-xs text-destructive mt-2">{fieldError('coilNo')}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FieldWrapper label="Charge no" error={fieldError('chargeNo')}>
          <input value={values.chargeNo} onChange={(e) => setValue('chargeNo', e.target.value)}
            className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
        </FieldWrapper>
        <FieldWrapper label="Base no" error={fieldError('baseNo')}>
          <input value={values.baseNo} onChange={(e) => setValue('baseNo', e.target.value)}
            className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
        </FieldWrapper>
        <FieldWrapper label="Furnace" error={fieldError('furnaceId')}>
          <select
            value={values.furnaceId || ''}
            onChange={(e) => setValue('furnaceId', parseInt(e.target.value, 10) || 0)}
            className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm`}
          >
            <option value="">Select</option>
            <option value="1">Furnace 1</option>
            <option value="2">Furnace 2</option>
            <option value="3">Furnace 3</option>
          </select>
        </FieldWrapper>
        <FieldWrapper label="Grade" error={fieldError('gradeCode')}>
          <input value={values.gradeCode} onChange={(e) => setValue('gradeCode', e.target.value)}
            className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`} />
        </FieldWrapper>
        <FieldWrapper label="Coils in charge">
          <div className={`${capture.inputHeight} flex items-center px-3 rounded-sm border border-border bg-secondary/40 font-mono text-sm`}>
            {values.noOfCoils || 0} (auto)
          </div>
        </FieldWrapper>
        <FieldWrapper label="Status" error={fieldError('status')}>
          <select
            value={values.status || ''}
            onChange={(e) => setValue('status', (e.target.value || undefined) as ANNFormValues['status'])}
            className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm`}
          >
            <option value="">—</option>
            <option value="FOR_ANN">FOR_ANN</option>
            <option value="IN_PROCESS">IN_PROCESS</option>
            <option value="RW">RW</option>
            <option value="DONE">DONE</option>
          </select>
        </FieldWrapper>
      </div>
    </div>
  );

  const metricsTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <FieldWrapper label="Dew point N2" error={fieldError('dewPointN2')}>{numBtn('dewPointN2')}</FieldWrapper>
      <FieldWrapper label="Dew point H2" error={fieldError('dewPointH2')}>{numBtn('dewPointH2')}</FieldWrapper>
      <FieldWrapper label="Temperature °C" error={fieldError('temperatureDegC')}>{numBtn('temperatureDegC')}</FieldWrapper>
      <FieldWrapper label="Loading MT" error={fieldError('loadingMt')}>{numBtn('loadingMt')}</FieldWrapper>
      <FieldWrapper label="Unloading MT" error={fieldError('unloadingMt')}>{numBtn('unloadingMt')}</FieldWrapper>
      <FieldWrapper label="Cumm loading MT" error={fieldError('cummLoadingMt')}>{numBtn('cummLoadingMt')}</FieldWrapper>
      <FieldWrapper label="Cumm unloading MT" error={fieldError('cummUnloadingMt')}>{numBtn('cummUnloadingMt')}</FieldWrapper>
      <FieldWrapper label="Expected unload time" error={fieldError('expUnloadingTime')}>
        <input
          type="datetime-local"
          value={values.expUnloadingTime || ''}
          onChange={(e) => setValue('expUnloadingTime', e.target.value)}
          className={`${capture.inputHeight} w-full rounded-sm border border-input bg-background px-3 text-sm font-mono`}
        />
      </FieldWrapper>
    </div>
  );

  const summary = (
    <div className="p-4 text-sm">
      <span className="z-rail-label">Charge summary</span>
      <p className="font-mono text-xs mt-2">{values.chargeNo || '—'}</p>
      <p className="font-mono text-xs text-muted-foreground mt-1">{values.noOfCoils} coils · F{values.furnaceId || '—'}</p>
    </div>
  );

  return (
    <ProcessCaptureShell
      tabs={[
        { id: 'charge', label: 'Charge', content: chargeTab },
        { id: 'metrics', label: 'Metrics', content: metricsTab },
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
      statusExtras={<ZBadge tone="muted" label={`${selectedCoilIds.length} selected`} />}
      footerExtras={isDirty ? <ZButton variant="ghost" fullWidth size="sm" onClick={reset}>Reset</ZButton> : null}
    />
  );
}
