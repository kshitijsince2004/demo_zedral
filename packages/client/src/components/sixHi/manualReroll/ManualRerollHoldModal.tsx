import { useEffect, useRef, useState } from 'react';
import { Ban, X } from 'lucide-react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { HOLD_ACTION_LABEL } from '../../../lib/orderLabels';
import { overlayClass } from '../../../lib/nativeOverlay';

interface ManualRerollHoldModalProps {
  open: boolean;
  batchLabel: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (remarks: string) => Promise<void>;
}

export function ManualRerollHoldModal({
  open,
  batchLabel,
  busy,
  onClose,
  onSubmit,
}: ManualRerollHoldModalProps) {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setRemarks('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [error]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!remarks.trim()) {
      setError('Hold remarks are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(remarks.trim());
      onClose();
      setRemarks('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Hold failed');
    } finally {
      setSubmitting(false);
    }
  };

  const locked = busy || submitting;

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        className={overlayClass('fixed inset-0 z-[110] bg-primary/60', 'backdrop-blur-[2px]')}
        onClick={locked ? undefined : onClose}
      />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-lg mx-auto border-2 border-warning bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 bg-warning/10 border-b border-warning/30 text-warning rounded-t-[14px]">
          <Ban className="h-6 w-6" />
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-foreground">{HOLD_ACTION_LABEL} re-roll</h3>
            <p className="text-sm font-medium text-muted-foreground truncate">{batchLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            className="hover:bg-warning/10 p-2 rounded-lg text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {error && (
            <div ref={errorRef} role="alert" className="bg-destructive/10 text-destructive text-sm p-3 rounded-xl border border-destructive/30">
              {error}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Re-roll moves to the Hold queue. The mill goes idle. Restart later from Hold → Move to Pending.
          </p>
          <label className="block text-sm">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Hold remarks <span className="text-destructive">*</span>
            </span>
            <ZInput
              className="mt-1"
              value={remarks}
              disabled={locked}
              placeholder="Why is this re-roll on hold?"
              onChange={(e) => setRemarks(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </label>
        </div>

        <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-border">
          <ZButton variant="ghost" className="flex-1 min-h-12" disabled={locked} onClick={onClose}>
            Cancel
          </ZButton>
          <ZButton
            className="flex-1 min-h-12"
            disabled={locked || !remarks.trim()}
            onClick={() => void handleSubmit()}
          >
            Submit {HOLD_ACTION_LABEL}
          </ZButton>
        </div>
      </div>
    </>
  );
}
