import { ShiftBoundaryService } from '../services/ShiftBoundaryService';
import { plantWallClock } from '@m1/shared-validation';

const BOUNDARY_HOURS_IST = [6, 14, 22];

function istNow(): Date {
  return plantWallClock();
}

function msUntilNextBoundary(): number {
  const at = istNow();
  const nowMs =
    at.getHours() * 3600000 + at.getMinutes() * 60000 + at.getSeconds() * 1000 + at.getMilliseconds();

  let bestDelay = Infinity;
  for (const hour of BOUNDARY_HOURS_IST) {
    const targetMs = hour * 3600000;
    let delay = targetMs - nowMs;
    if (delay <= 0) delay += 24 * 3600000;
    if (delay < bestDelay) bestDelay = delay;
  }

  return bestDelay + 5000;
}

export class ShiftBoundaryScheduler {
  private static timer: ReturnType<typeof setTimeout> | null = null;

  static start(): void {
    console.log('[ShiftBoundaryScheduler] Automatic boundary handovers are disabled per system policy.');
  }

  static stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private static scheduleNext(): void {
    const delay = msUntilNextBoundary();
    this.timer = setTimeout(() => {
      void this.runBoundary().finally(() => this.scheduleNext());
    }, delay);
  }

  static async runBoundary(): Promise<void> {
    try {
      const result = await ShiftBoundaryService.processAllMachines(istNow());
      console.log(
        `[ShiftBoundaryScheduler] processed ${result.processed} machines, ${result.handovers} boundary handovers`,
      );
    } catch (err) {
      console.error('[ShiftBoundaryScheduler] boundary run failed:', err);
    }
  }
}
