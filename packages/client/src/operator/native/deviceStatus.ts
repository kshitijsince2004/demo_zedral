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

export async function measurePingMs(timeoutMs = 4000): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(resolveHealthUrl(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return Math.max(0, Math.round(performance.now() - started));
  } catch {
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

  let snapshot: DeviceStatusSnapshot = EMPTY_DEVICE_STATUS;
  try {
    snapshot = { ...await DeviceStatusNative.getStatus(), pingMs: null };
  } catch (err) {
    console.warn('[DeviceStatus] Native plugin failed, using fallback', err);
    try {
      return await networkFallback();
    } catch {
      return EMPTY_DEVICE_STATUS;
    }
  }

  const online = snapshot.wifiConnected || snapshot.connectionType === 'cellular' || snapshot.connectionType === 'ethernet';
  const pingMs = online ? await measurePingMs() : null;
  return { ...snapshot, pingMs };
}
