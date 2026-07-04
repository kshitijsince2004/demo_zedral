import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { initDb } from '../db/sqlite';
import { startSyncEngine } from '../sync/engine';

export const isNative = () => Capacitor.isNativePlatform();

export async function initNative(): Promise<void> {
  await initDb();
  startSyncEngine();

  if (isNative()) {
    await KeepAwake.keepAwake();
  }
}
