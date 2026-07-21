/**
 * Closes non-live ACTIVE machine_shift_session rows (past shift-end + overtime grace).
 * Does NOT create handovers — operators submit those manually.
 * Live overtime sessions (within SHIFT_OVERTIME_GRACE_HOURS) stay open.
 */
import { ShiftDetectionService } from '../services/ShiftDetectionService';

const SWEEP_INTERVAL_MS = Number(process.env.SHIFT_STALE_SWEEP_MS ?? 60_000);

export class ShiftBoundaryScheduler {
  private static timer: ReturnType<typeof setInterval> | null = null;

  static start(): void {
    if (this.timer) return;
    console.log(
      `[ShiftBoundaryScheduler] Stale-session sweeper armed (every ${SWEEP_INTERVAL_MS}ms). Auto-handovers remain disabled.`,
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, SWEEP_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  static async tick(): Promise<number> {
    try {
      const closed = await ShiftDetectionService.closeAllStaleActiveSessions();
      if (closed > 0) {
        console.log(`[ShiftBoundaryScheduler] Closed ${closed} stale ACTIVE session(s)`);
      }
      return closed;
    } catch (err) {
      console.error('[ShiftBoundaryScheduler] Sweep failed:', err);
      return 0;
    }
  }
}
