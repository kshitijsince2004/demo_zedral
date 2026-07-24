import { useAuthStore } from '../authStore';
import { canWriteMachine } from '../machineRouting';
import * as outbox from './outboxRepo';
import { machineCodeFromOutboxUrl } from './outboxPolicy';
import { syncNow } from './engine';

export async function submitOrQueue(opts: {
  url: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  payload: unknown;
  aggregateKey: string;
}): Promise<{ queued: boolean; id: string }> {
  const id = crypto.randomUUID();
  const mill = machineCodeFromOutboxUrl(opts.url);
  if (mill) {
    const { role, machineAccess } = useAuthStore.getState();
    // Never enqueue Forbidden mill writes (e.g. handover:4HI/session for a 6HI-only user).
    if (!canWriteMachine(role, machineAccess, mill)) {
      return { id, queued: false };
    }
  }
  await outbox.enqueue({ id, ...opts });
  void syncNow('submit');

  return {
    id,
    queued: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  };
}
