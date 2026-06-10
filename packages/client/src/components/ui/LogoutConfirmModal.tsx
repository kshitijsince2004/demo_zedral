import { X } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';

interface LogoutConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function LogoutConfirmModal({ open, onClose, onConfirm }: LogoutConfirmModalProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-primary/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        className="fixed left-1/2 top-1/2 z-[105] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-white p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="logout-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="logout-title" className="font-mono text-lg font-bold">
              Sign Out
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Are you sure you want to log out?
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-md hover:bg-secondary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-3">
          <ZButton variant="secondary" fullWidth onClick={onClose}>
            Cancel
          </ZButton>
          <ZButton variant="destructive" fullWidth onClick={onConfirm}>
            Logout
          </ZButton>
        </div>
      </div>
    </>
  );
}
