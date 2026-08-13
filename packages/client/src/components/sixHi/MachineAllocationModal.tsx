import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { SixHiQueueCard } from '@m1/shared-validation';
import { ZButton } from '../primitives/ZButton';
import { millsForSubProcessFromRegistry } from '../../lib/machineRegistry';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { overlayClass } from '../../lib/nativeOverlay';

export type CrmMillCode = string;

export type MachineAllocationMode = 'production' | 'transfer';

interface MachineAllocationModalProps {
  open: boolean;
  mode?: MachineAllocationMode;
  batches: SixHiQueueCard[];
  /** Hub mill — preferred default in production mode so Assign opens this desk's workspace. */
  preferredMachine?: string;
  onClose: () => void;
  onConfirm: (machineCode: string) => Promise<void>;
}

export function MachineAllocationModal({
  open,
  mode = 'transfer',
  batches,
  preferredMachine,
  onClose,
  onConfirm,
}: MachineAllocationModalProps) {
  const firstBatch = batches[0];
  const [options, setOptions] = useState<string[]>([]);
  const isProduction = mode === 'production';
  const defaultMachine = (
    (isProduction ? preferredMachine : undefined)
    ?? firstBatch?.suggestedMachineCode
    ?? firstBatch?.machineCode
    ?? options[0]
    ?? ''
  ) as string;
  const [selected, setSelected] = useState<string>(defaultMachine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firstBatch) return;
    void millsForSubProcessFromRegistry(firstBatch.subProcess).then(setOptions);
  }, [firstBatch]);

  useEffect(() => {
    if (open && batches.length > 0) {
      const preferred = (isProduction ? preferredMachine : undefined)
        ?? firstBatch?.suggestedMachineCode
        ?? firstBatch?.machineCode
        ?? options[0]
        ?? '';
      setSelected(preferred && options.includes(preferred) ? preferred : (options[0] || ''));
      setError(null);
    }
  }, [open, batches, firstBatch, options, isProduction, preferredMachine]);

  if (!open || batches.length === 0 || !firstBatch) return null;

  const routeCode = firstBatch.subProcess === 'ROLLING' ? '4' : 'X';
  const processLabel = firstBatch.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass';
  const isMulti = batches.length > 1;

  const handleConfirm = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={overlayClass('fixed inset-0 z-[100] bg-primary/50', 'backdrop-blur-[2px]')} onClick={onClose} aria-hidden />
      <div
        className="fixed left-1/2 top-1/2 z-[105] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-white p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="machine-alloc-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {isProduction ? 'Move to Production' : isMulti ? 'Bulk Transfer' : 'Move to Machine'}
            </p>
            <h2 id="machine-alloc-title" className="font-mono text-lg font-bold mt-1">
              {isMulti ? `${batches.length} Orders Selected` : displayMotherCoilId(firstBatch)}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isMulti
                ? `${batches.length} orders selected`
                : `Batch ${firstBatch.batchNumber}`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{processLabel} · route {routeCode}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-md hover:bg-secondary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {isProduction
            ? `Select the ${processLabel.toLowerCase()} mill for ${isMulti ? 'this combined run' : 'this order'}. Process route ${routeCode} stays on the plan; only the assigned machine changes.`
            : `Select the destination mill. ${isMulti ? 'These orders' : 'This order'} will be transferred to that machine's queue.`}
        </p>

        <div className={[
          'grid gap-3 mb-4',
          options.length >= 3 ? 'grid-cols-3' : 'grid-cols-2',
        ].join(' ')}>
          {options.map((mill) => (
            <button
              key={mill}
              type="button"
              onClick={() => setSelected(mill)}
              className={[
                'min-h-14 rounded-xl border-2 font-bold text-base transition-colors',
                selected === mill
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-secondary/30 hover:border-primary/40',
              ].join(' ')}
            >
              {mill}
            </button>
          ))}
        </div>

        {!isMulti && firstBatch.suggestedMachineCode && firstBatch.suggestedMachineCode !== selected && (
          <p className="text-xs text-muted-foreground mb-3">
            Import hint: {firstBatch.suggestedMachineCode}
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive mb-3">{error}</p>
        )}

        <div className="flex gap-3">
          <ZButton variant="secondary" fullWidth onClick={onClose} disabled={busy}>
            Cancel
          </ZButton>
          <ZButton variant="accent" fullWidth onClick={handleConfirm} disabled={busy || !selected}>
            {busy
              ? 'Assigning…'
              : isProduction
                ? `Assign to ${selected}`
                : `Transfer to ${selected}`}
          </ZButton>
        </div>
      </div>
    </>
  );
}
