import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';

const DB_NAME = 'm1_offline_db';
const DB_VERSION = 1;

export interface SyncQueueItem {
  id: string; // UUID
  endpoint: string; // e.g., '/entries/hrs'
  method: 'POST' | 'PUT' | 'DELETE';
  payload: any;
  timestamp: string; // ISO String
  status: 'QUEUED' | 'SYNCING' | 'FAILED';
  retryCount: number;
}

class OfflineStore {
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Object store for the day's active production plans
        if (!db.objectStoreNames.contains('shift_plans')) {
          db.createObjectStore('shift_plans', { keyPath: 'id' });
        }
        
        // Object store for cached master data (e.g. dropdown options)
        if (!db.objectStoreNames.contains('master_data')) {
          db.createObjectStore('master_data', { keyPath: 'id' });
        }

        // Object store for offline mutations that need to be synced to the server
        if (!db.objectStoreNames.contains('sync_queue')) {
          const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          syncStore.createIndex('timestamp', 'timestamp'); // Allow ordered replay
          syncStore.createIndex('status', 'status');
        }
      }
    });
  }

  // --- Sync Queue Methods ---

  async enqueueMutation(item: Omit<SyncQueueItem, 'status' | 'retryCount' | 'timestamp'>) {
    const db = await this.dbPromise;
    const fullItem: SyncQueueItem = {
      ...item,
      timestamp: new Date().toISOString(),
      status: 'QUEUED',
      retryCount: 0
    };
    await db.put('sync_queue', fullItem);
    return fullItem;
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    const db = await this.dbPromise;
    // Get all items, ordered by timestamp (using the index)
    const tx = db.transaction('sync_queue', 'readonly');
    const index = tx.store.index('timestamp');
    return index.getAll();
  }

  async updateQueueItem(item: SyncQueueItem) {
    const db = await this.dbPromise;
    await db.put('sync_queue', item);
  }

  async removeQueueItem(id: string) {
    const db = await this.dbPromise;
    await db.delete('sync_queue', id);
  }

  // --- Master Data Caching ---

  async cacheMasterData(key: string, data: any) {
    const db = await this.dbPromise;
    await db.put('master_data', { id: key, data });
  }

  async getMasterData(key: string): Promise<any | null> {
    const db = await this.dbPromise;
    const record = await db.get('master_data', key);
    return record ? record.data : null;
  }

  // --- Shift Plans Caching ---

  async cachePlans(processId: string, date: string, plans: any[]) {
    const db = await this.dbPromise;
    const cacheKey = `${processId}_${date}`;
    await db.put('shift_plans', { id: cacheKey, plans, cachedAt: new Date().toISOString() });
  }

  async getPlans(processId: string, date: string): Promise<any[] | null> {
    const db = await this.dbPromise;
    const cacheKey = `${processId}_${date}`;
    const record = await db.get('shift_plans', cacheKey);
    return record ? record.plans : null;
  }
}

export const offlineStore = new OfflineStore();
