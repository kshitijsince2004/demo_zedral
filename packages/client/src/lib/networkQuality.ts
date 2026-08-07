import { Network } from '@capacitor/network';
import { measurePingMs } from '../operator/native/deviceStatus';

export type NetworkQualityLevel = 'good' | 'degraded' | 'bad';

export interface NetworkQuality {
  level: NetworkQualityLevel;
  p95RttMs: number | null;
  online: boolean;
  sampleCount: number;
}

const MAX_SAMPLES = 20;
const PROBE_MS = 20_000;
const GOOD_P95_MS = 150;
const DEGRADED_P95_MS = 800;

const samples: number[] = [];
const listeners = new Set<(q: NetworkQuality) => void>();

let started = false;
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let level: NetworkQualityLevel = online ? 'good' : 'bad';
let p95RttMs: number | null = null;

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx]!;
}

function classify(p95: number | null, isOnline: boolean): NetworkQualityLevel {
  if (!isOnline || p95 == null) return 'bad';
  if (p95 < GOOD_P95_MS) return 'good';
  if (p95 <= DEGRADED_P95_MS) return 'degraded';
  return 'bad';
}

function snapshot(): NetworkQuality {
  return {
    level,
    p95RttMs,
    online,
    sampleCount: samples.length,
  };
}

function emit() {
  const q = snapshot();
  for (const cb of listeners) cb(q);
}

async function probeOnce(): Promise<void> {
  try {
    const status = await Network.getStatus();
    online = status.connected;
  } catch {
    online = typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  if (!online) {
    p95RttMs = samples.length ? percentile95(samples) : null;
    level = 'bad';
    emit();
    return;
  }

  const rtt = await measurePingMs();
  if (rtt != null) {
    samples.push(rtt);
    if (samples.length > MAX_SAMPLES) samples.shift();
    p95RttMs = percentile95(samples);
  } else if (samples.length === 0) {
    p95RttMs = null;
  } else {
    p95RttMs = percentile95(samples);
  }

  level = classify(p95RttMs, online);
  emit();
}

export function getNetworkQuality(): NetworkQuality {
  return snapshot();
}

export function subscribeNetworkQuality(cb: (q: NetworkQuality) => void): () => void {
  listeners.add(cb);
  cb(snapshot());
  return () => {
    listeners.delete(cb);
  };
}

/** Adaptive request timeout: max(3s, p95×3), capped at 30s. Falls back to 10s before samples. */
export function adaptiveTimeoutMs(): number {
  if (p95RttMs == null || p95RttMs <= 0) return 10_000;
  return Math.min(30_000, Math.max(3_000, Math.round(p95RttMs * 3)));
}

export function startNetworkQualityProbe(): void {
  if (started) return;
  started = true;

  const onBrowserOnline = () => {
    online = true;
    void probeOnce();
  };
  const onBrowserOffline = () => {
    online = false;
    level = 'bad';
    emit();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
  }

  void Network.addListener('networkStatusChange', (status) => {
    online = status.connected;
    if (!status.connected) {
      level = 'bad';
      emit();
      return;
    }
    void probeOnce();
  }).catch(() => {
    // Web / missing plugin — browser events still work.
  });

  void probeOnce();
  setInterval(() => void probeOnce(), PROBE_MS);
}
