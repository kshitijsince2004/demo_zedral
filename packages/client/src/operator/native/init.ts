import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { startNetworkQualityProbe } from '../../lib/networkQuality';
import { initDb } from '../db/sqlite';
import { startSyncEngine } from '../sync/engine';

export const isNative = () => Capacitor.isNativePlatform();

let offlineReady = false;
let resolveOfflineReady: () => void;
/** Resolves once initDb() has settled (success or failure) and the sync engine is armed. */
export const offlineReadyPromise = new Promise<void>((resolve) => {
  resolveOfflineReady = resolve;
});
export const isOfflineReady = () => offlineReady;

export async function initNative(): Promise<void> {
  try {
    await initDb();
  } catch (err) {
    console.warn('[Operator] SQLite unavailable — offline queue disabled', err);
  }

  startNetworkQualityProbe();
  startSyncEngine();
  offlineReady = true;
  resolveOfflineReady();

  if (isNative()) {
    try {
      await KeepAwake.keepAwake();
    } catch (err) {
      console.warn('[Operator] KeepAwake unavailable', err);
    }
  }
}
