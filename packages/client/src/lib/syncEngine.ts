import { offlineStore } from './offlineStore';
import { getAuthHeaders } from './apiClient';

/**
 * SyncEngine manages the background synchronization of offline mutations.
 */
type SyncListener = () => void;

class SyncEngine {
  private isSyncing: boolean = false;
  private listeners: Set<SyncListener> = new Set();

  constructor() {
    // Attempt sync when the device comes back online
    window.addEventListener('online', () => this.sync());
  }

  /**
   * Subscribe to queue-change notifications (used by UI indicators such as the
   * persistent offline/queued banner). Returns an unsubscribe function.
   */
  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all subscribers that the queue may have changed so they can refresh
   * derived values (e.g. the pending count shown in the banner).
   */
  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Pushes a new mutation to the offline queue and immediately tries to sync if online.
   */
  async enqueue(endpoint: string, method: 'POST' | 'PUT' | 'DELETE', payload: any) {
    const item = await offlineStore.enqueueMutation({
      id: crypto.randomUUID(),
      endpoint,
      method,
      payload
    });

    // The queue grew; let indicators refresh.
    this.notify();

    if (navigator.onLine) {
      this.sync();
    }
    
    return item;
  }

  /**
   * Processes the sync queue in chronological order (First-In, First-Out).
   */
  async sync() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const queue = await offlineStore.getSyncQueue();
      const pendingItems = queue.filter(i => i.status === 'QUEUED' || i.status === 'FAILED');

      if (pendingItems.length === 0) {
        this.isSyncing = false;
        return;
      }

      console.log(`[SyncEngine] Starting batch sync of ${pendingItems.length} items`);

      // Mark all as syncing
      for (const item of pendingItems) {
        item.status = 'SYNCING';
        await offlineStore.updateQueueItem(item);
      }

      const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers.Authorization) {
        console.warn('[SyncEngine] No auth token — skipping sync until user logs in');
        for (const item of pendingItems) {
          item.status = 'QUEUED';
          await offlineStore.updateQueueItem(item);
        }
        return;
      }

      try {
        const response = await fetch('/api/sync/batch', {
          method: 'POST',
          headers,
          body: JSON.stringify({ items: pendingItems.map(i => ({ 
            url: i.endpoint, 
            method: i.method, 
            payload: i.payload, 
            timestamp: i.timestamp 
          }))})
        });

        if (response.status === 401) {
          console.warn('[SyncEngine] Session expired — re-login required before sync');
          for (const item of pendingItems) {
            item.status = 'QUEUED';
            await offlineStore.updateQueueItem(item);
          }
          return;
        }

        if (response.ok) {
          const { results } = await response.json();
          // Process results
          for (const item of pendingItems) {
            const res = results.find((r: any) => r.timestamp === item.timestamp);
            if (res && res.status === 'SUCCESS') {
              await offlineStore.removeQueueItem(item.id);
            } else {
              item.status = 'FAILED';
              item.retryCount += 1;
              await offlineStore.updateQueueItem(item);
            }
          }
          console.log(`[SyncEngine] Batch sync complete`);
        } else {
          throw new Error('Batch sync rejected by server');
        }
      } catch (error) {
        // Network error. Revert to FAILED
        for (const item of pendingItems) {
          item.status = 'FAILED';
          await offlineStore.updateQueueItem(item);
        }
        console.error(`[SyncEngine] Network error during batch sync`, error);
      }

    } finally {
      this.isSyncing = false;
      // Queue state changed during sync; let indicators refresh.
      this.notify();
    }
  }

  /**
   * Helper to get current queue length for UI badge display
   */
  async getPendingCount(): Promise<number> {
    const queue = await offlineStore.getSyncQueue();
    return queue.filter(i => i.status === 'QUEUED' || i.status === 'FAILED').length;
  }
}

export const syncEngine = new SyncEngine();
