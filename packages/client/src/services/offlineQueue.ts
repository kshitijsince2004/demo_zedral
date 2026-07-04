import { get, set, del } from 'idb-keyval';

/**
 * Saves a payload to IndexedDB.
 */
export const saveToOfflineQueue = async (key: string, data: unknown): Promise<void> => {
  try {
    await set(key, data);
  } catch (error) {
    console.error('Failed to save to offline queue', error);
  }
};

/**
 * Retrieves a payload from IndexedDB.
 */
export const getFromOfflineQueue = async (key: string): Promise<unknown> => {
  try {
    return await get(key);
  } catch (error) {
    console.error('Failed to get from offline queue', error);
    return null;
  }
};

/**
 * Removes a payload from IndexedDB after it has been restored or submitted.
 */
export const removeFromOfflineQueue = async (key: string): Promise<void> => {
  try {
    await del(key);
  } catch (error) {
    console.error('Failed to remove from offline queue', error);
  }
};
