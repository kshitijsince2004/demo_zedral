import { Capacitor, registerPlugin } from '@capacitor/core';
import { Network } from '@capacitor/network';

export interface DeviceStatusSnapshot {
  batteryLevel: number;
  isCharging: boolean;
  wifiConnected: boolean;
  connectionType: 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown';
  wifiRssi: number;
  wifiBars: number;
  /** Round-trip latency to API health endpoint; null when offline or unreachable. */
  pingMs: number | null;
}

interface DeviceStatusPlugin {
  getStatus(): Promise<DeviceStatusSnapshot>;
}

const DeviceStatusNative = registerPlugin<DeviceStatusPlugin>('DeviceStatus');

export const EMPTY_DEVICE_STATUS: DeviceStatusSnapshot = {
  batteryLevel: -1,
  isCharging: false,
  wifiConnected: false,
  connectionType: 'unknown',
  wifiRssi: -127,
  wifiBars: 0,
  pingMs: null,
};

let lastGoodPing: number | null = null;
let lastPingAt = 0;
const PING_CACHE_MS = 10_000;

export async function measurePingMs(timeoutMs = 6000): Promise<number | null> {
  const now = Date.now();
  if (lastGoodPing !== null && now - lastPingAt < PING_CACHE_MS) {
    return lastGoodPing;
  }

  const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  // APK: VITE_API_URL. Web/dev: same-origin so empty env still probes.
  const base = host
    ? host.endsWith('/api')
      ? host.slice(0, -4)
      : host
    : typeof window !== 'undefined'
      ? window.location.origin
      : '';
  if (!base) return null;

  // Prefer HTTPS; HTTP fallback only for broken device clocks / misconfigured TLS.
  const urls = [
    `${base}/health`,
    base.startsWith('https://') ? `http://${base.slice('https://'.length)}/health` : null,
  ].filter(Boolean) as string[];

  const globalStart = performance.now();

  for (const healthUrl of urls) {
    if (performance.now() - globalStart > timeoutMs) break;

    const controller = new AbortController();
    const attemptTimeout = Math.min(4000, timeoutMs - (performance.now() - globalStart));
    if (attemptTimeout < 500) break;
    const timer = setTimeout(() => controller.abort(), attemptTimeout);

    try {
      const started = performance.now();
      // cors (not no-cors): opaque responses hid failures and ST used to intercept /health.
      const res = await fetch(healthUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`health ${res.status}`);
      }
      const duration = Math.max(1, Math.round(performance.now() - started));
      lastGoodPing = duration;
      lastPingAt = Date.now();
      console.info(`[measurePingMs] Ping to ${healthUrl} success: ${duration}ms`);
      return duration;
    } catch (err) {
      console.debug(`[measurePingMs] Ping to ${healthUrl} failed`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  // If all attempts failed but we have a very recent good ping (e.g. from 30s ago),
  // use it as a fallback to avoid flickering the UI to "bad" on a single dropped packet.
  if (lastGoodPing !== null && Date.now() - lastPingAt < 30_000) {
    console.info(`[measurePingMs] All attempts failed, using recent good ping: ${lastGoodPing}ms`);
    return lastGoodPing;
  }
  console.warn(`[measurePingMs] All attempts failed. No recent fallback available.`);
  return null;
}

export const isAndroidApk = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

function mapNetworkType(
  connectionType: string,
): DeviceStatusSnapshot['connectionType'] {
  if (connectionType === 'wifi') return 'wifi';
  if (connectionType === 'cellular') return 'cellular';
  if (connectionType === 'none') return 'none';
  return 'unknown';
}

async function networkFallback(): Promise<DeviceStatusSnapshot> {
  const net = await Network.getStatus();
  const wifiConnected = net.connected && net.connectionType === 'wifi';
  const pingMs = net.connected ? await measurePingMs() : null;
  return {
    ...EMPTY_DEVICE_STATUS,
    wifiConnected,
    connectionType: mapNetworkType(net.connectionType),
    wifiBars: wifiConnected ? 2 : 0,
    pingMs,
  };
}

export async function readDeviceStatus(): Promise<DeviceStatusSnapshot> {
  if (!isAndroidApk()) return EMPTY_DEVICE_STATUS;

  let snapshot: DeviceStatusSnapshot;
  try {
    const raw = await DeviceStatusNative.getStatus();
    snapshot = { ...raw, pingMs: null };
  } catch (err) {
    console.warn('[DeviceStatus] Native plugin failed, using fallback', err);
    try {
      return await networkFallback();
    } catch {
      return EMPTY_DEVICE_STATUS;
    }
  }

  // Only measure ping if we are not already in a high-frequency loop or if status changed
  const online =
    snapshot.wifiConnected ||
    snapshot.connectionType === 'cellular' ||
    snapshot.connectionType === 'ethernet';
  const pingMs = online ? await measurePingMs() : null;
  return { ...snapshot, pingMs };
}
