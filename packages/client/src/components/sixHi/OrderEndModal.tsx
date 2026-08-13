import { useState } from 'react';
import { ZButton } from '../primitives/ZButton';
import { CheckSquare, X, AlertTriangle } from 'lucide-react';
import { getEndProductionMissingFields, type SixHiOrderDetail } from '@m1/shared-validation';
import { DefectTagSelector } from './DefectTagSelector';
import { DEFECT_OTHER_CODE } from '../../lib/defectCodes';
import { overlayClass } from '../../lib/nativeOverlay';

interface OrderEndModalProps {
  open: boolean;
  batchNumber: string;
  orderLabel?: string;
  orderSubtitle?: string;
  onClose: () => void;
  onConfirm: (defectCodes: string[]) => Promise<void>;
  order?: SixHiOrderDetail;
  /** Machine classification for defect tags (e.g. 6HI / CRM6). */
  appliesTo?: string;
}

export function OrderEndModal({ open, batchNumber, orderLabel, orderSubtitle, order, onClose, onConfirm, appliesTo }: OrderEndModalProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [otherRemarks, setOtherRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const toggleTag = (code: string) => {
    setSelectedTags((prev) => 
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const defectCodesForSubmit = () => {
    if (!selectedTags.includes(DEFECT_OTHER_CODE)) return selectedTags;
    const remarks = otherRemarks.trim();
    return remarks ? [...selectedTags.filter((c) => c !== DEFECT_OTHER_CODE), `OTHER:${remarks}`] : selectedTags;
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(defectCodesForSubmit());
      onClose();
      setSelectedTags([]);
      setOtherRemarks('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'End production failed');
    } finally {
      setBusy(false);
    }
  };

  const missingFields = order
    ? getEndProductionMissingFields({
        subProcess: order.subProcess,
        rolling: order.rolling,
        skinPass: order.skinPass,
      })
    : [];
  const isBlocked = missingFields.length > 0;

  return (
    <>
      <button type="button" aria-label="Close" className={overlayClass('fixed inset-0 z-[110] bg-primary/60', 'backdrop-blur-[2px]')} onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-xl mx-auto border border-border bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 bg-primary text-white rounded-t-[14px]">
          <CheckSquare className="h-6 w-6" />
          <div className="flex-1">
            <h3 className="text-lg font-bold">End Production</h3>
            <p className="text-sm font-medium opacity-90">{orderLabel ?? `Batch ${batchNumber}`}</p>
            {orderSubtitle && <p className="text-xs opacity-75">{orderSubtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-6">
          {error && (
            <div role="alert" className="bg-destructive/10 text-destructive text-sm p-3 rounded-xl border border-destructive/30">
              {error}
            </div>
          )}
          <div className="bg-secondary text-foreground text-sm p-4 rounded-xl font-medium border border-border">
            Are you sure you want to end the active production run? The machine will return to IDLE state.
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-bold text-foreground">Defect Tags (Optional)</h4>
            <p className="text-xs text-muted-foreground">Select any minor defects observed during this run.</p>
            <DefectTagSelector
              enabled={open}
              selected={selectedTags}
              onToggle={toggleTag}
              otherRemarks={otherRemarks}
              onOtherRemarksChange={setOtherRemarks}
              variant="end"
              appliesTo={appliesTo}
            />
          </div>

          {isBlocked && (
            <div className="bg-destructive/10 border-2 border-destructive/20 text-destructive p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <h4 className="text-sm font-bold">Mandatory Production Data Missing</h4>
              </div>
              <p className="text-xs font-medium opacity-90 pl-7">
                You must complete the following required fields before ending production:
              </p>
              <ul className="list-disc pl-11 text-xs font-medium space-y-1">
                {missingFields.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="shrink-0 flex gap-3 px-5 py-4 border-t border-border bg-secondary/30 rounded-b-[14px]">
          <ZButton variant="ghost" onClick={onClose} className="min-h-14 flex-1">Cancel</ZButton>
          <ZButton 
            variant="accent" 
            onClick={handleSubmit} 
            disabled={busy || isBlocked} 
            className="min-h-14 flex-1"
          >
            End Production
          </ZButton>
        </div>

      </div>
    </>
  );
}
