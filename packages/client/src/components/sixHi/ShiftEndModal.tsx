import { Clock, Moon, ArrowRightLeft, Thermometer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ZButton } from '../primitives/ZButton';
import { formatShiftWindowTime } from '../../lib/dateFormat';
import type { ShiftEndStatus } from '../../hooks/useShiftEndWatcher';
import { ShiftReadingsFields } from './shiftReadingsForm';
import {
  emptyShiftReadings,
  parseOptionalNumber,
  readingsFromSummary,
  type ShiftReadingsValues,
} from './shiftReadingsValues';
import { apiClient } from '../../lib/apiClient';

interface ShiftEndModalProps {
  open: boolean;
  status: ShiftEndStatus;
  shiftCode: string;
  shiftName: string;
  windowStart: string;
  windowEnd: string;
  prodDate: string;
  newShiftCode?: string | null;
  newShiftName?: string | null;
  reminderMinutes: number;
  shiftLogId?: string | null;
  onHandover: () => void;
  onRemindLater: () => void;
}

export function ShiftEndModal({
  open,
  status,
  shiftCode,
  shiftName,
  windowStart,
  windowEnd,
  prodDate,
  newShiftCode,
  newShiftName,
  reminderMinutes,
  shiftLogId,
  onHandover,
  onRemindLater,
}: ShiftEndModalProps) {
  const [readings, setReadings] = useState<ShiftReadingsValues>(emptyShiftReadings);
  const [readingsBusy, setReadingsBusy] = useState(false);
  const [readingsMsg, setReadingsMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !shiftLogId || status === 'none') return;
    let cancelled = false;
    void apiClient
      .get<{
        scrapKg?: number | null;
        coolantTempDegC?: number | null;
        coolantPressKgCm2?: number | null;
      }>(`/6hi/shift-summary/${encodeURIComponent(shiftLogId)}`)
      .then((summary) => {
        if (!cancelled) setReadings(readingsFromSummary(summary));
      })
      .catch(() => {
        if (!cancelled) setReadings(emptyShiftReadings);
      });
    return () => {
      cancelled = true;
    };
  }, [open, shiftLogId, status]);

  if (!open || status === 'none') return null;

  const isChanged = status === 'changed';
  const title = isChanged ? 'Shift Changed' : 'Shift Ended';

  const saveReadingsThen = async (next: () => void) => {
    if (!shiftLogId) {
      next();
      return;
    }
    const scrapKg = parseOptionalNumber(readings.scrapKg);
    const coolantTempDegC = parseOptionalNumber(readings.coolantTempDegC);
    const coolantPressKgCm2 = parseOptionalNumber(readings.coolantPressKgCm2);
    if (scrapKg === undefined && coolantTempDegC === undefined && coolantPressKgCm2 === undefined) {
      next();
      return;
    }
    setReadingsBusy(true);
    setReadingsMsg(null);
    try {
      await apiClient.put(`/shift-logs/${shiftLogId}/readings`, {
        scrapKg: scrapKg ?? null,
        coolantTempDegC: coolantTempDegC ?? null,
        coolantPressKgCm2: coolantPressKgCm2 ?? null,
      });
      next();
    } catch (err) {
      setReadingsMsg(err instanceof Error ? err.message : 'Could not save readings');
    } finally {
      setReadingsBusy(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[110] bg-primary/60 backdrop-blur-[2px]"
        aria-hidden
        onClick={() => void saveReadingsThen(onRemindLater)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-lg mx-auto border border-border bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 bg-primary text-white rounded-t-[14px]">
          {isChanged ? <ArrowRightLeft className="h-6 w-6" /> : <Moon className="h-6 w-6" />}
          <div className="flex-1">
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="text-sm font-medium opacity-90">
              {shiftName || `Shift ${shiftCode}`} · {prodDate}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          <div className="bg-secondary text-foreground text-sm p-4 rounded-xl font-medium border border-border">
            {isChanged ? (
              <>
                Your active session is still on{' '}
                <strong>{shiftName || `Shift ${shiftCode}`}</strong>, but the wall clock indicates{' '}
                <strong>{newShiftName || `Shift ${newShiftCode}`}</strong> is now scheduled.
                Complete the handover before beginning the new shift so in-progress work stays
                attributed to the correct shift.
              </>
            ) : (
              <>
                The <strong>{shiftName || `Shift ${shiftCode}`}</strong> shift has reached its scheduled
                end time. Submit your shift summary and complete the handover to close this session.
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
                Current Shift
              </p>
              <p className="font-semibold text-foreground text-sm">
                {shiftName || `Shift ${shiftCode}`}
              </p>
            </div>
            <div className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
                Production Date
              </p>
              <p className="font-semibold text-foreground text-sm">{prodDate || '—'}</p>
            </div>
            <div className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
                Shift Start
              </p>
              <p className="font-semibold text-foreground text-sm">
                {formatShiftWindowTime(windowStart)}
              </p>
            </div>
            <div className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
                Shift End
              </p>
              <p className="font-semibold text-foreground text-sm">
                {formatShiftWindowTime(windowEnd)}
              </p>
            </div>
          </div>

          {isChanged && (newShiftCode || newShiftName) && (
            <div className="flex items-center gap-2 bg-warning/10 border border-warning/40 text-warning-foreground rounded-xl px-4 py-3 text-sm font-medium">
              <Clock className="h-4 w-4 shrink-0" />
              <span>
                New shift now active by clock: <strong>{newShiftName || `Shift ${newShiftCode}`}</strong>
              </span>
            </div>
          )}

          {shiftLogId && (
            <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Thermometer className="h-4 w-4" />
                Shift readings (optional)
              </div>
              <p className="text-xs text-muted-foreground">
                Coolant and scrap are snapshotted on auto-handover if you miss the form later.
              </p>
              <ShiftReadingsFields
                values={readings}
                onChange={setReadings}
                disabled={readingsBusy}
              />
              {readingsMsg && <p className="text-xs text-destructive">{readingsMsg}</p>}
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col-reverse sm:flex-row gap-3 px-5 py-4 border-t border-border bg-secondary/30 rounded-b-[14px]">
          <ZButton
            variant="ghost"
            onClick={() => void saveReadingsThen(onRemindLater)}
            className="min-h-14 flex-1"
            disabled={readingsBusy}
          >
            Remind Me Later ({reminderMinutes}m)
          </ZButton>
          <ZButton
            variant="accent"
            onClick={() => void saveReadingsThen(onHandover)}
            className="min-h-14 flex-[2]"
            disabled={readingsBusy}
          >
            {readingsBusy ? 'Saving…' : 'Submit Summary & Handover'}
          </ZButton>
        </div>
      </div>
    </>
  );
}
