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

function resolveHealthUrl(): string {
  const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  if (!host) return '/health';
  const base = host.endsWith('/api') ? host.slice(0, -4) : host;
  return `${base}/health`;
}

let lastGoodPing: number | null = null;
let lastPingAt = 0;
const PING_CACHE_MS = 10_000;

export async function measurePingMs(timeoutMs = 4000): Promise<number | null> {
  const now = Date.now();
  if (lastGoodPing !== null && now - lastPingAt < PING_CACHE_MS) {
    return lastGoodPing;
  }

  const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  if (!host) return null;
  const base = host.endsWith('/api') ? host.slice(0, -4) : host;
  const healthUrl = `${base}/health`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    const duration = Math.max(1, Math.round(performance.now() - started));
    lastGoodPing = duration;
    lastPingAt = now;
    return duration;
  } catch (err) {
    console.debug('[measurePingMs] Ping failed', err);
    // If we have a recent good ping, keep using it for a while even on failure
    if (lastGoodPing !== null && now - lastPingAt < 30_000) {
      return lastGoodPing;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  const online = snapshot.wifiConnected || snapshot.connectionType === 'cellular' || snapshot.connectionType === 'ethernet';
  const pingMs = online ? await measurePingMs() : null;
  return { ...snapshot, pingMs };
}
