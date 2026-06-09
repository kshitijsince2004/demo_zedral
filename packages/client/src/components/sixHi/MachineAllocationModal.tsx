import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { SixHiQueueCard, SixHiSubProcess } from '@m1/shared-validation';
import { ZButton } from '../primitives/ZButton';

export type CrmMillCode = '6HI' | '4HI' | '2HI';

const ROLLING_MILLS: CrmMillCode[] = ['6HI', '4HI'];
const SKIN_PASS_MILLS: CrmMillCode[] = ['2HI', '4HI', '6HI'];

function millsForSubProcess(subProcess: SixHiSubProcess): CrmMillCode[] {
  return subProcess === 'ROLLING' ? ROLLING_MILLS : SKIN_PASS_MILLS;
}

interface MachineAllocationModalProps {
  open: boolean;
  batches: SixHiQueueCard[];
  onClose: () => void;
  onConfirm: (machineCode: CrmMillCode) => Promise<void>;
}

export function MachineAllocationModal({
  open,
  batches,
  onClose,
  onConfirm,
}: MachineAllocationModalProps) {
  const firstBatch = batches[0];
  const options = firstBatch ? millsForSubProcess(firstBatch.subProcess) : [];
  const defaultMachine = (firstBatch?.machineCode ?? firstBatch?.suggestedMachineCode ?? options[0]) as CrmMillCode;
  const [selected, setSelected] = useState<CrmMillCode>(defaultMachine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && batches.length > 0) {
      setSelected(defaultMachine);
      setError(null);
    }
  }, [open, batches, defaultMachine]);

  if (!open || batches.length === 0 || !firstBatch) return null;

  const processLabel = firstBatch.subProcess === 'ROLLING' ? 'Rolling (route 4)' : 'Skin Pass (route X)';
  const isMulti = batches.length > 1;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-primary/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        className="fixed left-1/2 top-1/2 z-[105] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-white p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="machine-alloc-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {isMulti ? 'Bulk Transfer' : 'Transfer Machine'}
            </p>
            <h2 id="machine-alloc-title" className="font-mono text-lg font-bold mt-1">
              {isMulti ? `${batches.length} Orders Selected` : firstBatch.batchNumber}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{processLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-md hover:bg-secondary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Select the destination mill. {isMulti ? 'These orders' : 'This order'} will be transferred and appear in that machine's queue.
        </p>

        <div className={[
          'grid gap-3 mb-4',
          options.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
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
          <ZButton variant="accent" fullWidth onClick={handleConfirm} disabled={busy}>
            {busy ? 'Transferring…' : `Transfer to ${selected}`}
          </ZButton>
        </div>
      </div>
    </>
  );
}
