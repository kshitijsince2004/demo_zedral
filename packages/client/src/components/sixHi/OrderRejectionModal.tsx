import { useState, useEffect, useRef } from 'react';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { AlertTriangle, X } from 'lucide-react';
import { HOLD_ACTION_LABEL } from '../../lib/orderLabels';
import { overlayClass } from '../../lib/nativeOverlay';
import { DEFECT_OTHER_CODE } from '../../lib/defectCodes';
import { DefectTagSelector } from './DefectTagSelector';

const REJECTION_REASONS = [
  { value: 'QUALITY_ISSUE', label: 'Quality Issue' },
  { value: 'DEFECT_FOUND', label: 'Defect Found' },
  { value: 'MATERIAL_ISSUE', label: 'Material Issue' },
  { value: 'CUSTOMER_REQUIREMENT_FAILURE', label: 'Customer Requirement Failure' },
  { value: 'OTHER', label: 'Other' },
] as const;

interface OrderRejectionModalProps {
  open: boolean;
  batchNumber: string;
  orderLabel?: string;
  orderSubtitle?: string;
  /** Machine classification for defect tags (e.g. 6HI / CRM6). */
  appliesTo?: string;
  /** HRS: pick which slit + batch to hold. */
  slitOptions?: Array<{ slitId: string; batchNumber?: string; label: string }>;
  onClose: () => void;
  onReject: (
    batchNo: string,
    rejectionReason: string,
    defectCodes: string[],
    remarks: string,
    slit?: { slitId: string; batchNumber?: string },
  ) => Promise<void>;
}

export function OrderRejectionModal({
  open, batchNumber, orderLabel, orderSubtitle, appliesTo, slitOptions, onClose, onReject,
}: OrderRejectionModalProps) {
  const [rejectionReason, setRejectionReason] = useState<string>(REJECTION_REASONS[0].value);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [otherDefectRemarks, setOtherDefectRemarks] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slitId, setSlitId] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (slitOptions?.length === 1) setSlitId(slitOptions[0].slitId);
    else if (slitOptions?.length) setSlitId((prev) => (
      slitOptions.some((s) => s.slitId === prev) ? prev : ''
    ));
  }, [open, slitOptions]);

  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [error]);

  if (!open) return null;

  const needsSlit = !!slitOptions?.length;
  const canSubmit = !!batchNumber.trim() && !!remarks.trim() && (!needsSlit || !!slitId);

  const toggleTag = (code: string) => {
    setSelectedTags((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const defectCodesForSubmit = () => {
    if (!selectedTags.includes(DEFECT_OTHER_CODE)) return selectedTags;
    const other = otherDefectRemarks.trim();
    return other ? [...selectedTags.filter((c) => c !== DEFECT_OTHER_CODE), `OTHER:${other}`] : selectedTags;
  };

  const handleSubmit = async () => {
    if (!batchNumber.trim()) {
      setError('No order selected for hold');
      return;
    }
    if (needsSlit && !slitId) {
      setError('Pick a slit to hold');
      return;
    }
    if (!remarks.trim()) {
      setError('Hold remarks are required');
      return;
    }
    if (selectedTags.includes(DEFECT_OTHER_CODE) && !otherDefectRemarks.trim()) {
      setError('Please enter remarks for the Other defect');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const picked = slitOptions?.find((s) => s.slitId === slitId);
      await onReject(
        batchNumber,
        rejectionReason,
        defectCodesForSubmit(),
        remarks.trim(),
        picked ? { slitId: picked.slitId, batchNumber: picked.batchNumber } : undefined,
      );
      onClose();
      setRejectionReason(REJECTION_REASONS[0].value);
      setSelectedTags([]);
      setOtherDefectRemarks('');
      setRemarks('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Order hold failed';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" aria-label="Close" className={overlayClass('fixed inset-0 z-[110] bg-primary/60', 'backdrop-blur-[2px]')} onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-xl mx-auto border-2 border-destructive bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        <div className="shrink-0 flex items-center gap-3 px-5 py-4 bg-destructive/10 border-b border-destructive/20 text-destructive rounded-t-[14px]">
          <AlertTriangle className="h-6 w-6" />
          <div className="flex-1">
            <h3 className="text-lg font-bold">Hold Order</h3>
            <p className="text-sm font-medium opacity-90">{orderLabel ?? (batchNumber ? `Batch ${batchNumber}` : 'No order selected')}</p>
            {orderSubtitle && <p className="text-xs opacity-75">{orderSubtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="hover:bg-destructive/10 p-2 rounded-lg" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-6">
          {error && (
            <div ref={errorRef} role="alert" className="bg-destructive/10 text-destructive text-sm p-3 rounded-xl border border-destructive/30">
              {error}
            </div>
          )}
          <div className="bg-red-50 text-red-800 text-sm p-4 rounded-xl font-medium border border-red-200">
            {needsSlit
              ? 'This slit will be held. Sibling slits stay in production and can still complete.'
              : 'Placing this order on hold will end production immediately and return the machine to IDLE state. This action cannot be undone.'}
          </div>

          {needsSlit ? (
            <FieldWrapper label="Slit" required>
              <div className="grid grid-cols-1 gap-2">
                {slitOptions!.map((opt) => (
                  <button
                    key={`${opt.slitId}:${opt.batchNumber ?? ''}`}
                    type="button"
                    onClick={() => setSlitId(opt.slitId)}
                    className={[
                      'min-h-12 rounded-xl border px-3 py-2 text-sm font-semibold text-left transition-colors',
                      slitId === opt.slitId
                        ? 'bg-destructive text-white border-destructive'
                        : 'bg-white text-foreground border-border hover:bg-secondary',
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </FieldWrapper>
          ) : null}

          <FieldWrapper label="Hold Reason" required>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {REJECTION_REASONS.map((reason) => (
                <button
                  key={reason.value}
                  type="button"
                  onClick={() => setRejectionReason(reason.value)}
                  className={[
                    'min-h-12 rounded-xl border px-3 py-2 text-sm font-semibold text-left transition-colors',
                    rejectionReason === reason.value
                      ? 'bg-destructive text-white border-destructive'
                      : 'bg-white text-foreground border-border hover:bg-secondary',
                  ].join(' ')}
                >
                  {reason.label}
                </button>
              ))}
            </div>
          </FieldWrapper>

          <div className="space-y-3">
            <h4 className="text-sm font-bold text-foreground">Defect Selection</h4>
            <DefectTagSelector
              enabled={open}
              selected={selectedTags}
              onToggle={toggleTag}
              otherRemarks={otherDefectRemarks}
              onOtherRemarksChange={setOtherDefectRemarks}
              variant="reject"
              appliesTo={appliesTo}
            />
          </div>

          <FieldWrapper label="Remarks" required>
            <ZInput
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter details about the hold…"
              className="min-h-14 text-base"
              inputMode="text"
            />
          </FieldWrapper>
        </div>

        <div className="shrink-0 flex gap-3 px-5 py-4 border-t border-border bg-secondary/30 rounded-b-[14px]">
          <ZButton variant="ghost" onClick={onClose} className="min-h-14 flex-1">Cancel</ZButton>
          <ZButton
            variant="danger"
            onClick={handleSubmit}
            disabled={busy || !canSubmit}
            className="min-h-14 flex-1"
          >
            Confirm {HOLD_ACTION_LABEL}
          </ZButton>
        </div>

      </div>
    </>
  );
}
