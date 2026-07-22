import { startSyncEngine as startBase, syncNow } from '../../lib/sync/engine';
import { pullMasters, pullPlan } from './pull';

export { syncNow };

export function startSyncEngine() {
  return startBase({
    afterPush: async () => {
      await pullMasters();
      await pullPlan();
    },
  });
}
