/**
 * Closes non-live ACTIVE machine_shift_session rows (past shift-end + overtime grace).
 * When AUTO_BOUNDARY_HANDOVER=shadow|on, runs Tier-1 carry-forward for forgotten handovers.
 * Live overtime sessions (within SHIFT_OVERTIME_GRACE_HOURS) stay open.
 */
import {
  getAutoBoundaryMode,
  ShiftBoundaryService,
} from '../services/ShiftBoundaryService';
import { logger } from '../utils/logger';

const SWEEP_INTERVAL_MS = Number(process.env.SHIFT_STALE_SWEEP_MS ?? 60_000);

export class ShiftBoundaryScheduler {
  private static timer: ReturnType<typeof setInterval> | null = null;
  /** Prevent overlapping ticks when a sweep runs longer than the interval. */
  private static running = false;

  static start(): void {
    if (this.timer) return;
    const mode = getAutoBoundaryMode();
    logger.info(
      JSON.stringify({
        msg: 'shift_boundary_scheduler_armed',
        intervalMs: SWEEP_INTERVAL_MS,
        mode,
      }),
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
    if (this.running) {
      logger.info(JSON.stringify({ msg: 'shift_boundary_scheduler_skip_overlap' }));
      return 0;
    }
    this.running = true;
    const started = Date.now();
    const mode = getAutoBoundaryMode();
    try {
      const closed = await ShiftBoundaryService.processStaleSessions(mode);
      logger.info(
        JSON.stringify({
          msg: 'shift_boundary_scheduler_tick',
          mode,
          closed,
          durationMs: Date.now() - started,
        }),
      );
      return closed;
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: 'shift_boundary_scheduler_failed',
          mode,
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}
