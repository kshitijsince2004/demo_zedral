/**
 * Re-drives journey advance for coils stranded after COMPLETED orders
 * when production.captured was lost (in-memory bus / restart).
 */
import { reconcileStrandedHandoffs } from '../services/journeyHandoff';
import { pruneIdempotencyKeys } from '../middleware/idempotencyMiddleware';
import { logger } from '../utils/logger';

const SWEEP_INTERVAL_MS = Number(process.env.JOURNEY_HANDOFF_SWEEP_MS ?? 60_000);

export class JourneyHandoffScheduler {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  static start(): void {
    if (process.env.JOURNEY_HANDOFF_SWEEP_ENABLED === 'false') return;
    if (this.timer) return;
    logger.info(
      JSON.stringify({
        msg: 'journey_handoff_scheduler_armed',
        intervalMs: SWEEP_INTERVAL_MS,
        backfillOnStart: process.env.JOURNEY_HANDOFF_BACKFILL === '1',
      }),
    );
    if (process.env.JOURNEY_HANDOFF_BACKFILL === '1') {
      void import('../services/journeyHandoff').then(({ backfillInv1Violations }) =>
        backfillInv1Violations().then((n) => {
          if (n > 0) logger.info(JSON.stringify({ msg: 'journey_handoff_startup_backfill', healed: n }));
        }),
      );
    }
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
      logger.info(JSON.stringify({ msg: 'journey_handoff_scheduler_skip_overlap' }));
      return 0;
    }
    this.running = true;
    const started = Date.now();
    try {
      void pruneIdempotencyKeys().catch(() => undefined);
      const healed = await reconcileStrandedHandoffs();
      if (healed > 0) {
        logger.info(
          JSON.stringify({
            msg: 'journey_handoff_scheduler_tick',
            healed,
            durationMs: Date.now() - started,
          }),
        );
      }
      return healed;
    } catch (err) {
      logger.error(
        JSON.stringify({
          msg: 'journey_handoff_scheduler_failed',
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
