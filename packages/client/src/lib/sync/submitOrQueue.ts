import * as outbox from './outboxRepo';
import { syncNow } from './engine';

export async function submitOrQueue(opts: {
  url: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  payload: unknown;
  aggregateKey: string;
}): Promise<{ queued: boolean; id: string }> {
  const id = crypto.randomUUID();
  await outbox.enqueue({ id, ...opts });
  void syncNow('submit');

  return {
    id,
    queued: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  };
}
