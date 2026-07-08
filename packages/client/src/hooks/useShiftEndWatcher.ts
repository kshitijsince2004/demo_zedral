import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../lib/apiClient';
import { useShiftStore } from '../store/shiftStore';
import type { DetectedShift } from '../lib/shiftDetection';

/**
 * Default interval used when the operator postpones the shift-end prompt via
 * "Remind Me Later". Configurable per call site.
 */
export const SHIFT_END_REMINDER_MS = 5 * 60 * 1000; // 5 minutes

/** How often the wall clock is compared against the pinned shift's end time. */
const CLOCK_CHECK_MS = 20_000;

/**
 * How often /shifts/current is polled to detect a *clock* shift change while a
 * previous session is still pinned. Mirrors the existing 15s operator polling.
 */
const SHIFT_POLL_MS = 15_000;

/** IST is a fixed UTC+05:30 offset (no DST), so this literal is always correct. */
const IST_OFFSET = '+05:30';

export type ShiftEndStatus = 'none' | 'ended' | 'changed';

export interface ShiftEndWatcherState {
  /** Current alert condition derived from the clock + polled shift. */
  status: ShiftEndStatus;
  /** Whether the modal should currently be shown (respects snooze + `enabled`). */
  visible: boolean;
  sessionShiftCode: string;
  sessionShiftName: string;
  windowStart: string;
  windowEnd: string;
  prodDate: string;
  /** Clock-detected shift code/name, populated only when it differs from the session. */
  newShiftCode: string | null;
  newShiftName: string | null;
  /** Postpone the prompt for `reminderMs`. */
  remindLater: () => void;
}

function toMinutes(hhmm: string): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.trim().slice(0, 5).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00${IST_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve the absolute instant (epoch ms) at which the pinned shift ends, in IST.
 * Handles the overnight shift (windowEnd <= windowStart rolls to the next day).
 */
export function resolveShiftEndInstant(
  prodDate: string,
  windowStart: string,
  windowEnd: string,
): number | null {
  if (!prodDate || !/^\d{4}-\d{2}-\d{2}/.test(prodDate) || !windowEnd) return null;
  const startMin = toMinutes(windowStart);
  const endMin = toMinutes(windowEnd);
  if (endMin == null) return null;
  const overnight = startMin != null && endMin <= startMin;
  const endDate = overnight ? addDays(prodDate, 1) : prodDate.slice(0, 10);
  const ts = Date.parse(`${endDate}T${windowEnd.slice(0, 5)}:00${IST_OFFSET}`);
  return Number.isNaN(ts) ? null : ts;
}

interface UseShiftEndWatcherOptions {
  /**
   * When false the watcher stops all timers/polling and never reports `visible`.
   * Used to suppress the prompt on the handover/summary pages themselves.
   */
  enabled?: boolean;
  reminderMs?: number;
}

/**
 * Lightweight background watcher for automatic shift-end + shift-change detection.
 *
 * - Reads the session-pinned shift (windowEnd/prodDate/shiftCode) from the shift store.
 * - Compares IST "now" against the pinned shift end (no API call).
 * - Polls /shifts/current (clock-based, no machine param) to detect when a *new*
 *   shift has started while the previous session is still open.
 * - Never switches the operator automatically — it only surfaces an alert so the
 *   operator can hand over, preserving production attribution.
 */
export function useShiftEndWatcher(
  options: UseShiftEndWatcherOptions = {},
): ShiftEndWatcherState {
  const { enabled = true, reminderMs = SHIFT_END_REMINDER_MS } = options;
  const detectedShift = useShiftStore((s) => s.detectedShift);

  const sessionShiftCode = detectedShift?.shiftCode ?? '';
  const sessionShiftName = detectedShift?.shiftName ?? '';
  const windowStart = detectedShift?.windowStart ?? '';
  const windowEnd = detectedShift?.windowEnd ?? '';
  const prodDate = detectedShift?.prodDate ?? '';

  const [ended, setEnded] = useState(false);
  const [clockShift, setClockShift] = useState<{ code: string; name: string } | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  // Monotonic tick that forces re-evaluation only while an alert may be pending
  // (so snooze expiry re-shows the prompt without polling-driven re-renders otherwise).
  const [, setNowTick] = useState(0);

  const endInstant = useMemo(
    () => resolveShiftEndInstant(prodDate, windowStart, windowEnd),
    [prodDate, windowStart, windowEnd],
  );

  const changed = Boolean(
    clockShift && sessionShiftCode && clockShift.code !== sessionShiftCode,
  );
  const alertActiveRef = useRef(false);
  alertActiveRef.current = enabled && (ended || changed);

  // Reset snooze whenever the pinned shift changes (a new session started).
  useEffect(() => {
    setSnoozeUntil(0);
    setEnded(false);
  }, [sessionShiftCode, prodDate]);

  // Clock watcher — compares IST now against the pinned shift end.
  useEffect(() => {
    if (!enabled || endInstant == null) {
      setEnded(false);
      return;
    }
    const check = () => {
      const isEnded = Date.now() >= endInstant;
      setEnded((prev) => (prev !== isEnded ? isEnded : prev));
      // Only force a re-render while an alert is pending so a lapsed snooze re-shows.
      if (alertActiveRef.current) setNowTick((t) => (t + 1) % 1_000_000);
    };
    check();
    const id = window.setInterval(check, CLOCK_CHECK_MS);
    return () => window.clearInterval(id);
  }, [enabled, endInstant]);

  // Shift-change watcher — polls the clock-based current shift and diffs it.
  useEffect(() => {
    if (!enabled) {
      setClockShift(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const shift = await apiClient.get<DetectedShift>('/shifts/current');
        if (cancelled) return;
        setClockShift((prev) =>
          prev && prev.code === shift.shiftCode ? prev : { code: shift.shiftCode, name: shift.shiftName },
        );
      } catch {
        // Non-fatal — transient network/auth errors are ignored; next tick retries.
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), SHIFT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  const remindLater = useCallback(() => {
    setSnoozeUntil(Date.now() + reminderMs);
  }, [reminderMs]);

  const status: ShiftEndStatus = changed ? 'changed' : ended ? 'ended' : 'none';
  const visible = enabled && status !== 'none' && Date.now() >= snoozeUntil;

  return {
    status,
    visible,
    sessionShiftCode,
    sessionShiftName,
    windowStart,
    windowEnd,
    prodDate,
    newShiftCode: changed && clockShift ? clockShift.code : null,
    newShiftName: changed && clockShift ? clockShift.name : null,
    remindLater,
  };
}
