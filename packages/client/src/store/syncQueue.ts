import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';
import { apiClient } from '../lib/apiClient';

export interface SyncQueueItem {
  id: string;
  method: 'POST';
  path: string;
  body: unknown;
  createdAt: string;
}

interface SyncQueueState {
  items: SyncQueueItem[];
  enqueue: (item: Omit<SyncQueueItem, 'id' | 'createdAt'>) => string;
  remove: (id: string) => void;
  processQueue: () => Promise<void>;
}

const storage: StateStorage = {
  getItem: async (name) => {
    const value = await get<string>(name);
    return value ?? null;
  },
  setItem: async (name, value) => {
    await set(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};

function makeQueueId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useSyncQueue = create<SyncQueueState>()(
  persist(
    (set, getState) => ({
      items: [],
      enqueue: (item) => {
        const id = makeQueueId();
        set((state) => ({
          items: [
            ...state.items,
            {
              ...item,
              id,
              createdAt: new Date().toISOString(),
            },
          ],
        }));
        return id;
      },
      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
      processQueue: async () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;

        for (const item of getState().items) {
          await apiClient.request(item.path, {
            method: item.method,
            body: item.body,
          });
          getState().remove(item.id);
        }
      },
    }),
    {
      name: 'm1-sync-queue',
      storage: createJSONStorage(() => storage),
    },
  ),
);
