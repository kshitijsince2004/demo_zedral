import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';
import { millsForSubProcessFromRegistry } from '../../lib/machineRegistry';
import { overlayClass } from '../../lib/nativeOverlay';

/** Rewinding-scoped machine pick — pool RWD | 2HI. */
export function RewindingMachineAllocationModal({
  open,
  batchNumber,
  coilLabel,
  suggested,
  onClose,
  onConfirm,
}: {
  open: boolean;
  batchNumber: string;
  coilLabel: string;
  suggested?: string;
  onClose: () => void;
  onConfirm: (machineCode: string) => Promise<void>;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void millsForSubProcessFromRegistry('REWINDING').then((opts) => {
      setOptions(opts);
      const pref = suggested && opts.includes(suggested) ? suggested : opts[0] ?? '';
      setSelected(pref);
      setError(null);
    });
  }, [open, suggested]);

  if (!open) return null;

  return (
    <>
      <button type="button" className={overlayClass('fixed inset-0 z-[100] bg-primary/50', 'backdrop-blur-[2px]')} onClick={onClose} aria-label="Close" />
      <div
        className="fixed left-1/2 top-1/2 z-[105] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="rwd-alloc-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Assign Machine
            </p>
            <h2 id="rwd-alloc-title" className="font-mono text-lg font-bold mt-1 text-foreground">{coilLabel}</h2>
            <p className="text-sm font-mono tabular-nums text-muted-foreground mt-1">Batch {batchNumber}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Rewinding · route R</p>
          </div>
          <ZButton type="button" variant="ghost" size="sm" onClick={onClose} className="!h-10 !w-10 !min-h-10 !px-0" aria-label="Close">
            <X className="h-5 w-5" />
          </ZButton>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Select RWD or 2HI for this rewinding order.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {options.map((code) => (
            <ZButton
              key={code}
              type="button"
              variant={selected === code ? 'primary' : 'secondary'}
              onClick={() => setSelected(code)}
              className="!min-h-12 !h-12 rounded-lg font-mono font-bold"
            >
              {code}
            </ZButton>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive mb-3">{error}</p>
        )}

        <div className="flex gap-2">
          <ZButton variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </ZButton>
          <ZButton
            variant="primary"
            className="flex-1"
            disabled={!selected || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(selected);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Assignment failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm
          </ZButton>
        </div>
      </div>
    </>
  );
}
