import { useState } from 'react';
import useSWR from 'swr';
import { X, Plus, Trash2 } from 'lucide-react';
import { overlayClass } from '../../lib/nativeOverlay';
import { matchesMachineClassification } from '@m1/shared-validation';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { apiClient } from '../../lib/apiClient';
import type { MasterDefectCode } from '@m1/shared-validation';
import { DEFECT_OTHER_CODE, resolveDefectCodes } from '../../lib/defectCodes';

interface RemarkDefectRow {
  defectCode: string;
  quantityAffected: string;
  remarks: string;
}

interface OrderRemarkModalProps {
  open: boolean;
  batchNumber: string;
  orderLabel?: string;
  orderSubtitle?: string;
  busy?: boolean;
  /** Machine classification filter (e.g. PKL, 6HI). */
  appliesTo?: string;
  onClose: () => void;
  onSave: (text: string, defects: { defectCode: string; quantityAffected?: number; remarks?: string }[]) => Promise<void>;
}

export function OrderRemarkModal({ open, batchNumber, orderLabel, orderSubtitle, busy, appliesTo, onClose, onSave }: OrderRemarkModalProps) {
  const [text, setText] = useState('');
  const [defectRows, setDefectRows] = useState<RemarkDefectRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const swrKey = open
    ? (appliesTo
      ? `/6hi/master/defect-codes?machine=${encodeURIComponent(appliesTo)}`
      : '/6hi/master/defect-codes')
    : null;
  const { data: defectsData } = useSWR(swrKey, async (url) => {
    return apiClient.get(url) as Promise<MasterDefectCode[]>;
  });
  const defects = resolveDefectCodes(defectsData).filter((d) => {
    if (!appliesTo || d.defectCode === DEFECT_OTHER_CODE) return true;
    return matchesMachineClassification(d.category, appliesTo);
  });

  if (!open) return null;

  const addDefectRow = () => {
    setDefectRows((prev) => [...prev, { defectCode: '', quantityAffected: '', remarks: '' }]);
  };

  const updateRow = (index: number, patch: Partial<RemarkDefectRow>) => {
    setDefectRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    setDefectRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!text.trim()) {
      setError('Remarks are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = defectRows
        .filter((row) => row.defectCode)
        .map((row) => {
          const code = row.defectCode === DEFECT_OTHER_CODE
            ? (row.remarks.trim() ? `OTHER:${row.remarks.trim()}` : DEFECT_OTHER_CODE)
            : row.defectCode;
          return {
            defectCode: code,
            quantityAffected: row.quantityAffected ? Number(row.quantityAffected) : undefined,
            remarks: row.defectCode === DEFECT_OTHER_CODE ? undefined : (row.remarks.trim() || undefined),
          };
        });
      await onSave(text.trim(), payload);
      setText('');
      setDefectRows([]);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save remark');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" aria-label="Close" className={overlayClass('fixed inset-0 z-[110] bg-primary/60', 'backdrop-blur-[2px]')} onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-2xl mx-auto border border-border bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-lg font-bold">Add Remark</h3>
            <p className="text-sm text-muted-foreground">{orderLabel ?? `Batch ${batchNumber}`}</p>
            {orderSubtitle && <p className="text-xs text-muted-foreground">{orderSubtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-xl border border-destructive/30">
              {error}
            </div>
          )}

          <FieldWrapper label="Remarks" required>
            <ZInput
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter remark details…"
              className="min-h-14 text-base"
            />
          </FieldWrapper>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-foreground">Associated Defects</h4>
              <ZButton variant="ghost" size="sm" onClick={addDefectRow}>
                <Plus className="h-4 w-4" />
                Add Defect
              </ZButton>
            </div>

            {defectRows.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Optional — tag one or more defect codes against this order.</p>
            ) : (
              defectRows.map((row, index) => {
                const selected = defects.find((d) => d.defectCode === row.defectCode);
                return (
                  <div key={index} className="border border-border rounded-xl p-4 space-y-3 bg-secondary/30">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Defect {index + 1}</p>
                      <button type="button" onClick={() => removeRow(index)} className="p-1 rounded hover:bg-secondary text-muted-foreground">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <FieldWrapper label="Defect Code">
                      <select
                        value={row.defectCode}
                        onChange={(e) => updateRow(index, { defectCode: e.target.value })}
                        className="w-full min-h-12 rounded-xl border border-border bg-white px-3 text-sm"
                      >
                        <option value="">Select defect…</option>
                        {defects.map((d) => (
                          <option key={d.defectCode} value={d.defectCode}>
                            {d.defectCode} — {d.defectName}
                          </option>
                        ))}
                      </select>
                    </FieldWrapper>
                    {selected && row.defectCode !== DEFECT_OTHER_CODE && (
                      <p className="text-xs text-muted-foreground">{selected.defectName}</p>
                    )}
                    <FieldWrapper label="Quantity Affected (Optional)">
                      <ZInput
                        value={row.quantityAffected}
                        onChange={(e) => updateRow(index, { quantityAffected: e.target.value })}
                        inputMode="decimal"
                        placeholder="MT"
                      />
                    </FieldWrapper>
                    <FieldWrapper label={row.defectCode === DEFECT_OTHER_CODE ? 'Other defect remarks' : 'Defect Remarks'} required={row.defectCode === DEFECT_OTHER_CODE}>
                      <ZInput
                        value={row.remarks}
                        onChange={(e) => updateRow(index, { remarks: e.target.value })}
                        placeholder="Optional notes for this defect"
                      />
                    </FieldWrapper>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="shrink-0 flex gap-3 px-5 py-4 border-t border-border bg-secondary/30 rounded-b-[14px]">
          <ZButton variant="ghost" onClick={onClose} className="min-h-14 flex-1">Cancel</ZButton>
          <ZButton variant="accent" onClick={handleSubmit} disabled={busy || saving || !text.trim()} className="min-h-14 flex-1">
            Save Remark
          </ZButton>
        </div>
      </div>
    </>
  );
}
