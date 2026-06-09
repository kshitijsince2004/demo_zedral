import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useShiftStore } from '../../store/shiftStore';
import { useSixHiStore } from '../../store/sixHiStore';
import { millSupportsRolling } from '../../lib/millConfig';
import { apiClient, ApiError } from '../../lib/apiClient';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';

type Step = 'warning' | 'form';

const EMPTY_FORM = {
  batch_number: '',
  coil_no: '',
  slit_id: '',
  customer_name: '',
  grade_code: '',
  width_mm: '',
  input_thk_mm: '',
  ppc_thk_mm: '',
  ppc_weight_mt: '',
  sub_process: 'ROLLING' as 'ROLLING' | 'SKIN_PASS',
  destination: 'ANNEALING' as 'ANNEALING' | 'REWINDING',
  roll_finish: '',
  ppc_reroll_flag: false,
  sap_order_no: '',
};

export function SixHiManualOrderModal() {
  const { manualOrderOpen, closeManualOrder, requestQueueRefresh, busy, setBusy, machineCode } = useSixHiStore();
  const { shiftDate, shiftCode } = useShiftStore();
  const [step, setStep] = useState<Step>('warning');
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (manualOrderOpen && !millSupportsRolling(machineCode)) {
      setForm((f) => ({ ...f, sub_process: 'SKIN_PASS' }));
    }
  }, [manualOrderOpen, machineCode]);

  if (!manualOrderOpen) return null;

  const reset = () => {
    setStep('warning');
    setForm(EMPTY_FORM);
    setError(null);
  };

  const handleClose = () => {
    reset();
    closeManualOrder();
  };

  const handleSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      const payload = {
        batch_number: form.batch_number.trim(),
        plan_date: shiftDate || new Date().toISOString().slice(0, 10),
        shift_code: shiftCode || 'A',
        machine_code: machineCode,
        sub_process: millSupportsRolling(machineCode) ? form.sub_process : 'SKIN_PASS',
        coil_no: form.coil_no.trim(),
        slit_id: form.slit_id.trim() || undefined,
        customer_name: form.customer_name.trim(),
        grade_code: form.grade_code.trim(),
        width_mm: Number(form.width_mm),
        input_thk_mm: form.input_thk_mm ? Number(form.input_thk_mm) : undefined,
        ppc_thk_mm: Number(form.ppc_thk_mm),
        ppc_weight_mt: Number(form.ppc_weight_mt),
        destination: form.sub_process === 'ROLLING' ? form.destination : undefined,
        roll_finish: form.roll_finish.trim() || undefined,
        ppc_reroll_flag: form.ppc_reroll_flag,
        sap_order_no: form.sap_order_no.trim() || undefined,
      };

      await apiClient.post('/6hi/orders/manual', payload);
      requestQueueRefresh();
      handleClose();
    } catch (err) {
      const msg = err instanceof ApiError
        ? (err.body as { error?: string } | undefined)?.error ?? err.message
        : 'Failed to create order';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="fixed inset-0 z-[120] bg-primary/50" onClick={handleClose} aria-label="Close" />
      <div
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[125] max-w-2xl mx-auto bg-white border border-border rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Manual order entry"
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-border bg-primary text-white">
          <h2 className="text-lg font-bold">New Order — Manual Entry</h2>
          <button type="button" onClick={handleClose} className="min-h-10 min-w-10 flex items-center justify-center rounded-lg hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 'warning' ? (
          <div className="p-6 space-y-4 overflow-auto">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-[#FEF3C7] border border-[#F59E0B] text-[#92400E]">
              <AlertTriangle className="h-6 w-6 shrink-0 mt-0.5" aria-hidden />
              <div className="space-y-2 text-sm">
                <p className="font-bold text-base">Warning — Manual Order Entry</p>
                <p>Orders should normally come from the PPC plan import. Manual entry is for exceptional cases only.</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Verify batch number and coil details before saving.</li>
                  <li>Incorrect data may affect production records and shift reporting.</li>
                  <li>Supervisor approval may be required for audit purposes.</li>
                </ul>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <ZButton variant="ghost" onClick={handleClose}>Cancel</ZButton>
              <ZButton variant="accent" onClick={() => setStep('form')}>I Understand — Continue</ZButton>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-5 space-y-4">
            {error && (
              <p className="text-sm text-destructive font-medium bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FieldWrapper label="Batch Number">
                <ZInput value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} className="min-h-12 text-base" placeholder="PPC-B-YYYYMMDD-R001" />
              </FieldWrapper>
              {millSupportsRolling(machineCode) ? (
                <FieldWrapper label="Sub Process">
                  <select
                    value={form.sub_process}
                    onChange={(e) => setForm({ ...form, sub_process: e.target.value as 'ROLLING' | 'SKIN_PASS' })}
                    className="w-full min-h-12 rounded-md border border-input bg-background px-3 text-base"
                  >
                    <option value="ROLLING">Rolling</option>
                    <option value="SKIN_PASS">Skin Pass</option>
                  </select>
                </FieldWrapper>
              ) : (
                <FieldWrapper label="Sub Process">
                  <ZInput value="Skin Pass" readOnly className="min-h-12 text-base bg-muted/30" />
                </FieldWrapper>
              )}
              <FieldWrapper label="Mother Coil Number">
                <ZInput value={form.coil_no} onChange={(e) => setForm({ ...form, coil_no: e.target.value })} className="min-h-12 text-base" />
              </FieldWrapper>
              <FieldWrapper label="Slit ID (optional)">
                <ZInput value={form.slit_id} onChange={(e) => setForm({ ...form, slit_id: e.target.value })} className="min-h-12 text-base" />
              </FieldWrapper>
              <FieldWrapper label="Customer">
                <ZInput value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} className="min-h-12 text-base" />
              </FieldWrapper>
              <FieldWrapper label="Grade Code">
                <ZInput value={form.grade_code} onChange={(e) => setForm({ ...form, grade_code: e.target.value })} className="min-h-12 text-base" placeholder="e.g. HROP" />
              </FieldWrapper>
              <FieldWrapper label="Width (mm)">
                <ZInput type="number" inputMode="decimal" value={form.width_mm} onChange={(e) => setForm({ ...form, width_mm: e.target.value })} className="min-h-12 text-base" />
              </FieldWrapper>
              <FieldWrapper label="Input Thickness (mm)">
                <ZInput type="number" inputMode="decimal" value={form.input_thk_mm} onChange={(e) => setForm({ ...form, input_thk_mm: e.target.value })} className="min-h-12 text-base" placeholder="Optional" />
              </FieldWrapper>
              <FieldWrapper label="Target Thickness (mm)">
                <ZInput type="number" inputMode="decimal" value={form.ppc_thk_mm} onChange={(e) => setForm({ ...form, ppc_thk_mm: e.target.value })} className="min-h-12 text-base" />
              </FieldWrapper>
              <FieldWrapper label="Weight (Metric Tons)">
                <ZInput type="number" inputMode="decimal" value={form.ppc_weight_mt} onChange={(e) => setForm({ ...form, ppc_weight_mt: e.target.value })} className="min-h-12 text-base" />
              </FieldWrapper>
              {form.sub_process === 'ROLLING' && (
                <>
                  <FieldWrapper label="Destination">
                    <select
                      value={form.destination}
                      onChange={(e) => setForm({ ...form, destination: e.target.value as 'ANNEALING' | 'REWINDING' })}
                      className="w-full min-h-12 rounded-md border border-input bg-background px-3 text-base"
                    >
                      <option value="ANNEALING">Annealing</option>
                      <option value="REWINDING">Rewinding</option>
                    </select>
                  </FieldWrapper>
                  <FieldWrapper label="Roll Finish (optional)">
                    <ZInput value={form.roll_finish} onChange={(e) => setForm({ ...form, roll_finish: e.target.value })} className="min-h-12 text-base" />
                  </FieldWrapper>
                  <div className="flex items-center gap-2 min-h-12">
                    <input
                      type="checkbox"
                      id="reroll"
                      checked={form.ppc_reroll_flag}
                      onChange={(e) => setForm({ ...form, ppc_reroll_flag: e.target.checked })}
                      className="h-5 w-5"
                    />
                    <label htmlFor="reroll" className="text-sm font-medium">Re-Roll Order</label>
                  </div>
                </>
              )}
              <FieldWrapper label="SAP Order Number (optional)">
                <ZInput value={form.sap_order_no} onChange={(e) => setForm({ ...form, sap_order_no: e.target.value })} className="min-h-12 text-base" />
              </FieldWrapper>
            </div>

            <p className="text-xs text-muted-foreground">
              Plan date: {shiftDate || 'today'} · Shift: {shiftCode || 'A'} · Machine: {machineCode}
            </p>

            <div className="flex gap-3 justify-end pt-2">
              <ZButton variant="ghost" onClick={() => setStep('warning')}>Back</ZButton>
              <ZButton variant="ghost" onClick={handleClose}>Cancel</ZButton>
              <ZButton
                variant="accent"
                disabled={busy || !form.batch_number || !form.coil_no || !form.customer_name || !form.grade_code || !form.width_mm || !form.ppc_thk_mm || !form.ppc_weight_mt}
                onClick={handleSubmit}
              >
                Create Order
              </ZButton>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
