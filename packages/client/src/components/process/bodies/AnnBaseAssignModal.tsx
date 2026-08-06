import { useEffect, useState } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';

type BaseOpt = { base_no: string };

export function AnnBaseAssignModal({
  open,
  chargeNo,
  title,
  confirmLabel,
  onClose,
  onAssigned,
}: {
  open: boolean;
  chargeNo: string;
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onAssigned: (baseNo: string) => Promise<void> | void;
}) {
  const [bases, setBases] = useState<BaseOpt[]>([]);
  const [baseNo, setBaseNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBaseNo('');
    void apiClient.get<{ bases: BaseOpt[] }>(`/stations/ann/vacant-bases?exceptChargeNo=${encodeURIComponent(chargeNo)}`)
      .then((r) => setBases(r.bases ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load bases'));
  }, [chargeNo, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-lg space-y-3">
        <h2 className="text-sm font-bold">{title}</h2>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Base
          <select
            className="h-10 min-h-10 rounded-lg border border-input bg-background px-3 text-sm"
            value={baseNo}
            onChange={(e) => setBaseNo(e.target.value)}
          >
            <option value="">Select base</option>
            {bases.map((b) => (
              <option key={b.base_no} value={b.base_no}>{b.base_no}</option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <ZButton type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</ZButton>
          <ZButton
            type="button"
            variant="primary"
            disabled={busy || !baseNo}
            onClick={() => {
              if (!window.confirm(`Assign base ${baseNo} to this batch?`)) return;
              setBusy(true);
              setError(null);
              void Promise.resolve(onAssigned(baseNo))
                .then(() => onClose())
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Assign failed'))
                .finally(() => setBusy(false));
            }}
          >
            {confirmLabel}
          </ZButton>
        </div>
      </div>
    </div>
  );
}
