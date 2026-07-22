import { FormEvent, useMemo, useState } from 'react';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { submitOrQueue } from '../../lib/sync/submitOrQueue';
import { useManualDraft } from '../../lib/useFormDraft';

interface CaptureFormProps {
  machineCode: string;
  shiftLogId: string;
}

interface FieldConfig {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'time';
  required?: boolean;
}

interface ProcessFormConfig {
  title: string;
  endpoint: string;
  fields: FieldConfig[];
}

const commonFields: FieldConfig[] = [
  { name: 'coilNo', label: 'Coil No', required: true },
  { name: 'slNo', label: 'SL No', type: 'number' },
  { name: 'timeFrom', label: 'Time From', type: 'time' },
  { name: 'timeTo', label: 'Time To', type: 'time' },
  { name: 'remarks', label: 'Remarks' },
];

const configs: Record<string, ProcessFormConfig> = {
  HRS: {
    title: 'HRS Production Capture',
    endpoint: 'hrs',
    fields: [
      ...commonFields,
      { name: 'nominalWidthMm', label: 'Nominal Width mm', type: 'number' },
      { name: 'actualWidthMm', label: 'Actual Width mm', type: 'number' },
      { name: 'nominalThkMm', label: 'Nominal Thickness mm', type: 'number' },
      { name: 'weightMt', label: 'Weight MT', type: 'number' },
      { name: 'scrapMt', label: 'Scrap MT', type: 'number' },
    ],
  },
  PKL: {
    title: 'PKL Production Capture',
    endpoint: 'pkl',
    fields: [
      ...commonFields,
      { name: 'widthMm', label: 'Width mm', type: 'number' },
      { name: 'thkMm', label: 'Thickness mm', type: 'number' },
      { name: 'weightMt', label: 'Weight MT', type: 'number' },
      { name: 'lineSpeedMpm', label: 'Line Speed mpm', type: 'number' },
      { name: 'heatNo', label: 'Heat No' },
      { name: 'source', label: 'Source' },
      { name: 'wip', label: 'WIP' },
      { name: 'leaderEnd', label: 'Leader End' },
    ],
  },
  ANN: {
    title: 'ANN Charge Capture',
    endpoint: 'ann',
    fields: [
      ...commonFields,
      { name: 'chargeNo', label: 'Charge No', required: true },
      { name: 'baseNo', label: 'Base No' },
      { name: 'furnaceId', label: 'Furnace ID', type: 'number' },
      { name: 'gradeCode', label: 'Grade Code' },
      { name: 'noOfCoils', label: 'No. of Coils', type: 'number' },
      { name: 'chargeWtMt', label: 'Charge Weight MT', type: 'number' },
      { name: 'temperatureDegc', label: 'Temperature C', type: 'number' },
    ],
  },

  RWD: {
    title: 'RWD Production Capture',
    endpoint: 'rwd',
    fields: [
      ...commonFields,
      { name: 'widthMm', label: 'Width mm', type: 'number' },
      { name: 'thkMm', label: 'Input Thickness mm', type: 'number' },
      { name: 'outputThkMm', label: 'Output Thickness mm', type: 'number' },
      { name: 'weightMt', label: 'Weight MT', type: 'number' },
      { name: 'surfaceFinish', label: 'Surface Finish' },
    ],
  },
  CRS: {
    title: 'CRS Production Capture',
    endpoint: 'crs',
    fields: [
      ...commonFields,
      { name: 'slitNo', label: 'Slit No' },
      { name: 'coilWidthMm', label: 'Coil Width mm', type: 'number' },
      { name: 'nominalThkMm', label: 'Nominal Thickness mm', type: 'number' },
      { name: 'actualWidthMm', label: 'Actual Width mm', type: 'number' },
      { name: 'outputWtMt', label: 'Output Weight MT', type: 'number' },
      { name: 'forCtlMt', label: 'For CTL MT', type: 'number' },
    ],
  },
  CTL: {
    title: 'CTL Production Capture',
    endpoint: 'ctl',
    fields: [
      ...commonFields,
      { name: 'widthMm', label: 'Width mm', type: 'number' },
      { name: 'thkMm', label: 'Thickness mm', type: 'number' },
      { name: 'weightMt', label: 'Input Weight MT', type: 'number' },
      { name: 'nominalSetLengthMm', label: 'Nominal Set Length mm', type: 'number' },
      { name: 'actualLengthMm', label: 'Actual Length mm', type: 'number' },
      { name: 'noPieces', label: 'No. Pieces', type: 'number' },
      { name: 'noBundles', label: 'No. Bundles', type: 'number' },
      { name: 'totalProdMt', label: 'Total Production MT', type: 'number' },
    ],
  },
};

function buildPayload(
  config: ProcessFormConfig,
  values: Record<string, string>,
  props: CaptureFormProps,
): Record<string, string | number | boolean> {
  const payload: Record<string, string | number | boolean> = {
    machineCode: props.machineCode,
    shiftLogId: props.shiftLogId,
  };

  for (const field of config.fields) {
    const raw = values[field.name]?.trim();
    if (!raw) continue;
    payload[field.name] = field.type === 'number' ? Number(raw) : raw;
  }

  if (config.endpoint === 'ann' && !payload.chargeNo && payload.coilNo) {
    payload.chargeNo = String(payload.coilNo);
  }

  return payload;
}

function CaptureForm({ machineCode, shiftLogId, config }: CaptureFormProps & { config: ProcessFormConfig }) {
  const isOnline = useNetworkStatus();
  const initialValues = useMemo(
    () => Object.fromEntries(config.fields.map((field) => [field.name, ''])),
    [config],
  );
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draftKey = `capture_${machineCode}_${shiftLogId}_${config.endpoint}`;
  const { clearDraft } = useManualDraft(values, setValues, draftKey);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);

    const payload = buildPayload(config, values, { machineCode, shiftLogId });
    const path = `/production/${config.endpoint}`;

    try {
      const result = await submitOrQueue({
        url: path,
        method: 'POST',
        payload,
        aggregateKey: `shiftlog:${shiftLogId}`,
      });
      setStatus(result.queued ? `Saved locally. Sync queue item ${result.id} will replay when online.` : 'Saved locally. Sync will complete shortly.');
      clearDraft();
      setValues(initialValues);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save production entry');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {machineCode} · Shift Log {shiftLogId}
        </p>
        <h2 className="text-xl font-semibold text-foreground">{config.title}</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {config.fields.map((field) => (
          <ZInput
            key={field.name}
            label={field.label}
            required={field.required}
            type={field.type === 'time' ? 'time' : field.type === 'number' ? 'number' : 'text'}
            inputMode={field.type === 'number' ? 'decimal' : undefined}
            value={values[field.name] ?? ''}
            onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
          />
        ))}
      </div>

      {status && <p className="text-sm font-medium text-emerald-700">{status}</p>}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <ZButton type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving...' : isOnline ? 'Save Entry' : 'Save Offline'}
        </ZButton>
        {!isOnline && <span className="text-xs text-muted-foreground">Offline mode active</span>}
      </div>
    </form>
  );
}

export function HrsCaptureForm(props: CaptureFormProps) {
  return <CaptureForm {...props} config={configs.HRS} />;
}

export function PklCaptureForm(props: CaptureFormProps) {
  return <CaptureForm {...props} config={configs.PKL} />;
}

export function AnnCaptureForm(props: CaptureFormProps) {
  return <CaptureForm {...props} config={configs.ANN} />;
}



export function RwdCaptureForm(props: CaptureFormProps) {
  return <CaptureForm {...props} config={configs.RWD} />;
}

export function CrsCaptureForm(props: CaptureFormProps) {
  return <CaptureForm {...props} config={configs.CRS} />;
}

export function CtlCaptureForm(props: CaptureFormProps) {
  return <CaptureForm {...props} config={configs.CTL} />;
}
