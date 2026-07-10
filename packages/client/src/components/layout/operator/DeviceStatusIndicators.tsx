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

function pingLabel(connected: boolean, pingMs: number | null): string {
  if (!connected) return 'Offline';
  if (pingMs == null) return '— ms';
  return `${pingMs} ms`;
}

export function DeviceStatusIndicators() {
  const status = useAndroidDeviceStatus();

  if (!isAndroidApk()) return null;

  const batteryLevel = status.batteryLevel;
  const isCharging = status.isCharging;
  const wifiBars = status.wifiBars;
  const wifiConnected = status.wifiConnected;
  const wifiRssi = status.wifiRssi;
  const networkOnline = wifiConnected || status.connectionType === 'cellular' || status.connectionType === 'ethernet';
  const pingMs = status.pingMs;

  const BatteryIcon = batteryIcon(batteryLevel, isCharging);
  const WifiIcon = wifiIcon(wifiBars, wifiConnected);
  const batteryPct = batteryLevel >= 0 ? `${batteryLevel}%` : '…';
  const pingText = pingLabel(networkOnline, pingMs);

  return (
    <div className="flex items-center gap-3 pr-3 border-r border-border mr-1 shrink-0">
      <div
        className={`flex items-center gap-1.5 shrink-0 ${batteryTone(batteryLevel, isCharging)}`}
        title={isCharging ? `Battery ${batteryPct} — charging` : `Battery ${batteryPct}`}
      >
        <BatteryIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-mono text-[11px] font-black tabular-nums leading-none">
          {batteryPct}
        </span>
      </div>

      <div
        className={`flex items-center gap-1.5 shrink-0 ${wifiTone(wifiBars, wifiConnected)}`}
        title={
          networkOnline && pingMs != null
            ? `${wifiLabel(wifiBars, wifiConnected, wifiRssi)} · ${pingMs} ms latency`
            : wifiLabel(wifiBars, wifiConnected, wifiRssi)
        }
      >
        <WifiIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-mono text-[11px] font-black tabular-nums leading-none min-w-[3.25rem] text-right">
          {pingText}
        </span>
      </div>
    </div>
  );
}
