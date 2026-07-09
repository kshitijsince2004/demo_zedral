import {
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

export function DeviceStatusIndicators() {
  const status = useAndroidDeviceStatus();

  if (!isAndroidApk() || !status) return null;

  const BatteryIcon = batteryIcon(status.batteryLevel, status.isCharging);
  const WifiIcon = wifiIcon(status.wifiBars, status.wifiConnected);
  const batteryPct = status.batteryLevel >= 0 ? `${status.batteryLevel}%` : '—';

  return (
    <div className="hidden sm:flex items-center gap-2 pr-1 border-r border-border mr-1">
      <div
        className={`flex items-center gap-1 ${batteryTone(status.batteryLevel, status.isCharging)}`}
        title={status.isCharging ? `Battery ${batteryPct} — charging` : `Battery ${batteryPct}`}
        aria-label={status.isCharging ? `Battery ${batteryPct}, charging` : `Battery ${batteryPct}`}
      >
        <BatteryIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-mono text-[11px] font-semibold tabular-nums">{batteryPct}</span>
      </div>
      <div
        className={`flex items-center gap-1 ${wifiTone(status.wifiBars, status.wifiConnected)}`}
        title={wifiLabel(status.wifiBars, status.wifiConnected, status.wifiRssi)}
        aria-label={wifiLabel(status.wifiBars, status.wifiConnected, status.wifiRssi)}
      >
        <WifiIcon className="h-4 w-4 shrink-0" aria-hidden />
        {status.wifiConnected && status.wifiBars > 0 && (
          <span className="font-mono text-[11px] font-semibold tabular-nums">{status.wifiBars}/4</span>
        )}
      </div>
    </div>
  );
}
