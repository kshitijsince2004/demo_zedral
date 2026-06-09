import { useState } from 'react';
import type { SixHiRollChange } from '@m1/shared-validation';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';

interface RollChangePanelProps {
  history: SixHiRollChange[];
  onLog: (data: { rollPosition: 'IN' | 'OUT'; newRollNo: string; newRollCode?: string; reasonText?: string }) => Promise<void>;
  busy?: boolean;
  disabled?: boolean;
}

export function RollChangePanel({ history, onLog, busy, disabled }: RollChangePanelProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<'IN' | 'OUT'>('OUT');
  const [rollNo, setRollNo] = useState('');
  const [rollCode, setRollCode] = useState('');
  const [reason, setReason] = useState('');

  const submit = async () => {
    if (!rollNo.trim()) return;
    await onLog({ rollPosition: position, newRollNo: rollNo.trim(), newRollCode: rollCode || undefined, reasonText: reason || undefined });
    setRollNo('');
    setRollCode('');
    setReason('');
    setOpen(false);
  };

  return (
    <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Roll Changes</h3>
        <ZButton variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} disabled={disabled}>
          {open ? 'Cancel' : 'Log Change'}
        </ZButton>
      </div>

      {open && (
        <div className="space-y-3 border border-border rounded-xl p-3 bg-secondary/50">
          <div className="flex gap-2">
            {(['IN', 'OUT'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPosition(p)}
                className={[
                  'flex-1 min-h-14 rounded-xl border text-sm font-semibold',
                  position === p ? 'bg-primary text-white border-primary' : 'border-border bg-white',
                ].join(' ')}
              >
                Roll {p}
              </button>
            ))}
          </div>
          <FieldWrapper label="New Roll No">
            <ZInput value={rollNo} onChange={(e) => setRollNo(e.target.value)} className="min-h-14" />
          </FieldWrapper>
          <FieldWrapper label="Roll Code">
            <ZInput value={rollCode} onChange={(e) => setRollCode(e.target.value)} className="min-h-14" />
          </FieldWrapper>
          <FieldWrapper label="Reason">
            <ZInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Scheduled / Mechanical…" className="min-h-14" />
          </FieldWrapper>
          <ZButton variant="accent" fullWidth size="lg" onClick={submit} disabled={busy || !rollNo.trim()} className="min-h-14">
            Save Roll Change
          </ZButton>
        </div>
      )}

      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roll changes logged for this order.</p>
      ) : (
        <ul className="space-y-2 max-h-48 overflow-auto">
          {history.map((rc) => (
            <li key={rc.id} className="text-sm border border-border/60 rounded-xl px-3 py-2 bg-secondary/40">
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-foreground">Roll {rc.rollPosition}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(rc.changedAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="font-mono text-xs mt-1">
                {rc.prevRollNo ?? '—'} → {rc.newRollNo}
                {rc.reasonText ? ` · ${rc.reasonText}` : ''}
              </p>
              {rc.operatorName && <p className="text-xs text-muted-foreground mt-0.5">{rc.operatorName}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
