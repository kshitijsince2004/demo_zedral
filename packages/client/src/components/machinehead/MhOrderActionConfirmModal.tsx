import { X } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';
import { overlayClass } from '../../lib/nativeOverlay';

interface MhOrderActionConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** Soft in-app confirm for destructive / reinstate actions on MH order panels. */
export function MhOrderActionConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onClose,
  onConfirm,
}: MhOrderActionConfirmModalProps) {
  if (!open) return null;

  return (
    <>
      <div
        className={overlayClass('fixed inset-0 z-[250] bg-black/40', 'backdrop-blur-sm')}
        onClick={busy ? undefined : onClose}
        aria-hidden
      />
      <div
        className="fixed left-1/2 top-1/2 z-[260] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background text-foreground p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="mh-order-action-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="mh-order-action-title" className="font-mono text-lg font-bold">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-3 mt-6">
          <ZButton variant="secondary" fullWidth onClick={onClose} disabled={busy}>
            Cancel
          </ZButton>
          <ZButton
            variant={danger ? 'danger' : 'primary'}
            fullWidth
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </ZButton>
        </div>
      </div>
    </>
  );
}
