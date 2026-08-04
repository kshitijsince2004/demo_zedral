import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useShiftStore } from '../../store/shiftStore';
import { currentPlantDate } from '../../lib/dateFormat';
import { ApiError } from '../../lib/apiClient';
import { createManualRwdOrder } from '../../lib/rewindingWrites';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';

type Step = 'warning' | 'form';

const EMPTY = {
  batch_number: '',
  coil_no: '',
  slit_id: '',
  customer_name: '',
  grade_code: '',
  width_mm: '',
  input_thk_mm: '',
  ppc_thk_mm: '',
  ppc_weight_mt: '',
  machine_code: 'RWD' as 'RWD' | '2HI',
  roll_finish: '',
};

/** Manual rewinding order — no rolling fields. */
export function RewindingManualOrderModal({
  open,
  defaultMachine = 'RWD',
  onClose,
  onCreated,
}: {
  open: boolean;
  defaultMachine?: 'RWD' | '2HI';
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { shiftDate, shiftCode } = useShiftStore();
  const [step, setStep] = useState<Step>('warning');
  const [form, setForm] = useState({ ...EMPTY, machine_code: defaultMachine });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setStep('warning');
    setForm({ ...EMPTY, machine_code: defaultMachine });
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      await createManualRwdOrder({
        batch_number: form.batch_number.trim(),
        plan_date: shiftDate || currentPlantDate(),
        shift_code: shiftCode || 'A',
        machine_code: form.machine_code,
        coil_no: form.coil_no.trim(),
        slit_id: form.slit_id.trim() || undefined,
        customer_name: form.customer_name.trim(),
        grade_code: form.grade_code.trim(),
        width_mm: Number(form.width_mm),
        input_thk_mm: form.input_thk_mm ? Number(form.input_thk_mm) : undefined,
        ppc_thk_mm: Number(form.ppc_thk_mm),
        ppc_weight_mt: Number(form.ppc_weight_mt),
        roll_finish: form.roll_finish.trim() || undefined,
      });
      onCreated?.();
      handleClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? ((err.body as { error?: string } | undefined)?.error ?? err.message)
          : 'Failed to create order';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <button type="button" className="fixed inset-0 z-[120] bg-primary/50" onClick={handleClose} aria-label="Close" />
      <div
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[125] max-w-2xl mx-auto bg-background border border-border rounded-lg shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Manual rewinding order"
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-border bg-primary text-primary-foreground">
          <h2 className="text-lg font-bold">New Rewinding Order</h2>
          <ZButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="!min-h-10 !h-10 !w-10 !px-0 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </ZButton>
        </div>

        {step === 'warning' ? (
          <div className="p-6 space-y-4 overflow-auto">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/15 border border-warning/40 text-foreground">
              <AlertTriangle className="h-6 w-6 shrink-0 mt-0.5 text-warning" aria-hidden />
              <div className="space-y-2 text-sm">
                <p className="font-bold text-base">Manual Order Entry</p>
                <p>Prefer PPC rewinding plan import. Manual entry is for exceptional cases only.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <ZButton variant="secondary" onClick={handleClose}>Cancel</ZButton>
              <ZButton variant="primary" onClick={() => setStep('form')}>Continue</ZButton>
            </div>
          </div>
        ) : (
          <div className="p-5 overflow-auto space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FieldWrapper label="Batch Number" required>
                <ZInput value={form.batch_number} onChange={(e) => set('batch_number', e.target.value)} className="font-mono" />
              </FieldWrapper>
              <FieldWrapper label="Coil No" required>
                <ZInput value={form.coil_no} onChange={(e) => set('coil_no', e.target.value)} className="font-mono" />
              </FieldWrapper>
              <FieldWrapper label="Slit ID">
                <ZInput value={form.slit_id} onChange={(e) => set('slit_id', e.target.value)} className="font-mono" />
              </FieldWrapper>
              <FieldWrapper label="Machine" required>
                <select
                  className="w-full min-h-11 rounded-lg border border-input bg-background px-3 text-sm font-mono"
                  value={form.machine_code}
                  onChange={(e) => set('machine_code', e.target.value)}
                >
                  <option value="RWD">RWD</option>
                  <option value="2HI">2HI</option>
                </select>
              </FieldWrapper>
              <FieldWrapper label="Customer" required>
                <ZInput value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} />
              </FieldWrapper>
              <FieldWrapper label="Grade" required>
                <ZInput value={form.grade_code} onChange={(e) => set('grade_code', e.target.value)} className="font-mono" />
              </FieldWrapper>
              <FieldWrapper label="Width (mm)" required>
                <ZInput type="number" value={form.width_mm} onChange={(e) => set('width_mm', e.target.value)} className="font-mono" />
              </FieldWrapper>
              <FieldWrapper label="Pre-stage Thk (mm)">
                <ZInput type="number" value={form.input_thk_mm} onChange={(e) => set('input_thk_mm', e.target.value)} className="font-mono" />
              </FieldWrapper>
              <FieldWrapper label="PPC Thk (mm)" required>
                <ZInput type="number" value={form.ppc_thk_mm} onChange={(e) => set('ppc_thk_mm', e.target.value)} className="font-mono" />
              </FieldWrapper>
              <FieldWrapper label="Weight (MT)" required>
                <ZInput type="number" value={form.ppc_weight_mt} onChange={(e) => set('ppc_weight_mt', e.target.value)} className="font-mono" />
              </FieldWrapper>
              <FieldWrapper label="Finish">
                <ZInput value={form.roll_finish} onChange={(e) => set('roll_finish', e.target.value)} placeholder="MATT / BRIGHT" />
              </FieldWrapper>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <ZButton variant="secondary" onClick={handleClose} disabled={busy}>Cancel</ZButton>
              <ZButton variant="primary" onClick={() => void handleSubmit()} disabled={busy}>
                Create Order
              </ZButton>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
