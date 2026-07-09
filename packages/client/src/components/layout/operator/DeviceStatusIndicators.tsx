import {
  Activity,
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Wifi,
  WifiHigh,
  WifiLow,
  WifiOff,
} from 'lucide-react';
import { useAndroidDeviceStatus } from '../../../hooks/useAndroidDeviceStatus';
import { isAndroidApk } from '../../../operator/native/deviceStatus';

function batteryIcon(level: number, charging: boolean) {
  if (charging) return BatteryCharging;
  if (level >= 80) return BatteryFull;
  if (level >= 40) return BatteryMedium;
  if (level >= 0) return BatteryLow;
  return Battery;
}

function batteryTone(level: number, charging: boolean): string {
  if (charging) return 'text-success';
  if (level < 0) return 'text-muted-foreground/60';
  if (level < 20) return 'text-destructive';
  if (level < 40) return 'text-warning';
  return 'text-muted-foreground';
}

function wifiIcon(bars: number, connected: boolean) {
  if (!connected || bars <= 0) return WifiOff;
  if (bars >= 4) return WifiHigh;
  if (bars <= 1) return WifiLow;
  return Wifi;
}

function wifiTone(bars: number, connected: boolean): string {
  if (!connected || bars <= 0) return 'text-destructive';
  if (bars <= 1) return 'text-warning';
  return 'text-muted-foreground';
}

function wifiLabel(bars: number, connected: boolean, rssi: number): string {
  if (!connected) return 'Wi‑Fi disconnected';
  if (bars <= 0) return 'Wi‑Fi connected — weak signal';
  return `Wi‑Fi signal ${bars}/4 (${rssi} dBm)`;
}

/** Battery + Wi‑Fi indicators for the operator Android APK status rail only. */
export function DeviceStatusIndicators() {
  const status = useAndroidDeviceStatus();

  if (!isAndroidApk()) return null;

  const BatteryIcon = batteryIcon(status.batteryLevel, status.isCharging);
  const WifiIcon = wifiIcon(status.wifiBars, status.wifiConnected);
  const batteryPct = status.batteryLevel >= 0 ? `${status.batteryLevel}%` : '—';

  return (
    <div className="flex items-center gap-3 shrink-0">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Activity className="h-3.5 w-3.5 text-info animate-pulse" aria-hidden />
        <span className="text-[10px] uppercase tracking-[0.12em] font-medium">Live</span>
      </div>

      <div
        className={`flex items-center gap-1 ${batteryTone(status.batteryLevel, status.isCharging)}`}
        title={status.isCharging ? `Battery ${batteryPct} — charging` : `Battery ${batteryPct}`}
        aria-label={status.isCharging ? `Battery ${batteryPct}, charging` : `Battery ${batteryPct}`}
      >
        <BatteryIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="font-mono text-[10px] font-bold tabular-nums min-w-[2ch]">{batteryPct}</span>
      </div>

      <div
        className={`flex items-center gap-1 ${wifiTone(status.wifiBars, status.wifiConnected)}`}
        title={wifiLabel(status.wifiBars, status.wifiConnected, status.wifiRssi)}
        aria-label={wifiLabel(status.wifiBars, status.wifiConnected, status.wifiRssi)}
      >
        <WifiIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="font-mono text-[10px] font-bold tabular-nums min-w-[2ch]">
          {status.wifiConnected ? `${Math.max(status.wifiBars, 1)}/4` : '—'}
        </span>
      </div>
    </div>
  );
}
