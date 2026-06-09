import { X } from 'lucide-react';
import { StoppageSubForm } from '../forms/StoppageSubForm';
import { ZButton } from '../primitives/ZButton';

interface QuickStoppageDrawerProps {
  shiftLogId: string;
  open: boolean;
  onClose: () => void;
}

export function QuickStoppageDrawer({ shiftLogId, open, onClose }: QuickStoppageDrawerProps) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close stoppage drawer"
        className="fixed inset-0 z-40 bg-background/60"
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md border-l border-border bg-card flex flex-col animate-slide-in shadow-none"
        role="dialog"
        aria-label="Quick stoppage log"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Log stoppage</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Record downtime without leaving station</p>
          </div>
          <ZButton variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </ZButton>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <StoppageSubForm shiftLogId={shiftLogId} />
        </div>
      </aside>
    </>
  );
}
