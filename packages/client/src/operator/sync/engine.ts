import { startSyncEngine as startBase, syncNow } from '../../lib/sync/engine';
import { prefetchOperatorCaches, pullMasters, pullPlan } from './pull';

export { syncNow };

export function startSyncEngine() {
  // PERF-C4 — warm caches as soon as the operator shell boots (login may already be present).
  void prefetchOperatorCaches().catch(() => undefined);

  return startBase({
    afterPush: async () => {
      await pullMasters();
      await pullPlan();
    },
  });
}
