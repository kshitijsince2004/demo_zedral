import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { initDb } from '../db/sqlite';
import { startSyncEngine } from '../sync/engine';

export const isNative = () => Capacitor.isNativePlatform();

export async function initNative(): Promise<void> {
  try {
    await initDb();
  } catch (err) {
    console.warn('[Operator] SQLite unavailable — offline queue disabled', err);
  }

  startSyncEngine();

  if (isNative()) {
    try {
      await KeepAwake.keepAwake();
    } catch (err) {
      console.warn('[Operator] KeepAwake unavailable', err);
    }
  }
}
