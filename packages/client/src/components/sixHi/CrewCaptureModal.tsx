import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';
import { machineCrewService, type MachineCrewMember } from '../../lib/machineCrewService';
import { apiClient } from '../../lib/apiClient';

const SNOOZE_MS = 5 * 60 * 1000;

interface CrewCaptureModalProps {
  open: boolean;
  machineCode: string;
  sessionId: string;
  onDone: () => void;
  onSnooze: () => void;
}

/** Soft-mandatory crew capture at session start. Does not block production. */
export function CrewCaptureModal({
  open,
  machineCode,
  sessionId,
  onDone,
  onSnooze,
}: CrewCaptureModalProps) {
  const [roster, setRoster] = useState<MachineCrewMember[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !machineCode) return;
    void machineCrewService.list(machineCode).then((res) => {
      const members = res.crew ?? [];
      setRoster(members);
      setSelected(new Set(members.map((m) => m.id)));
    }).catch(() => setRoster([]));
  }, [open, machineCode]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/crew/attach', {
        sessionId,
        crewIds: [...selected],
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save crew');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[110] bg-primary/40 backdrop-blur-[1px]" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shift crew"
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-lg mx-auto border border-border bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 bg-primary text-white rounded-t-[14px]">
          <Users className="h-6 w-6" />
          <div>
            <h3 className="text-lg font-bold">Who is on this shift?</h3>
            <p className="text-sm opacity-90">{machineCode}</p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            Confirm crew for this session. You can snooze and we&apos;ll ask again — production is not blocked.
          </p>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roster members for this machine. Ask Machine Head to add crew.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              {roster.map((m) => (
                <li key={m.id}>
                  <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/40">
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="h-4 w-4"
                    />
                    <span className="flex-1 text-sm font-medium">{m.memberName}</span>
                    <span className="text-xs text-muted-foreground uppercase">{m.roleLabel}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="shrink-0 flex flex-col-reverse sm:flex-row gap-3 px-5 py-4 border-t border-border bg-secondary/30 rounded-b-[14px]">
          <ZButton variant="ghost" onClick={onSnooze} className="min-h-14 flex-1">
            Remind Me Later (5m)
          </ZButton>
          <ZButton
            variant="accent"
            onClick={() => void submit()}
            disabled={busy || selected.size === 0}
            className="min-h-14 flex-[2]"
          >
            {busy ? 'Saving…' : 'Confirm Crew'}
          </ZButton>
        </div>
      </div>
    </>
  );
}

export { SNOOZE_MS as CREW_CAPTURE_SNOOZE_MS };
