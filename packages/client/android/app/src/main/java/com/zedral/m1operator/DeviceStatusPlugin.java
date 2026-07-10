package com.zedral.m1operator;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DeviceStatus")
public class DeviceStatusPlugin extends Plugin {
    private static final String TAG = "DeviceStatusPlugin";

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("Context unavailable");
            return;
        }

        JSObject ret = new JSObject();
        try {
            int batteryLevel = readBatteryLevel(ctx);
            boolean isCharging = readIsCharging(ctx);
            
            Log.d(TAG, "Battery Level: " + batteryLevel + ", Charging: " + isCharging);

            ret.put("batteryLevel", batteryLevel);
            ret.put("isCharging", isCharging);

            boolean wifiConnected = false;
            String connectionType = "none";
            int rssi = -127;

            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Network active = cm.getActiveNetwork();
                    if (active != null) {
                        NetworkCapabilities caps = cm.getNetworkCapabilities(active);
                        if (caps != null) {
                            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                                wifiConnected = true;
                                connectionType = "wifi";
                            } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                                connectionType = "cellular";
                            } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                                connectionType = "ethernet";
                            }
                        }
                    }
                } else {
                    @SuppressWarnings("deprecation")
                    NetworkInfo info = cm.getActiveNetworkInfo();
                    if (info != null && info.isConnected()) {
                        wifiConnected = info.getType() == ConnectivityManager.TYPE_WIFI;
                        connectionType = info.getTypeName().toLowerCase();
                    }
                }
            }

            if (wifiConnected) {
                WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    WifiInfo info = wm.getConnectionInfo();
                    if (info != null) {
                        rssi = info.getRssi();
                        Log.d(TAG, "WiFi RSSI: " + rssi);
                    }
                }
            }

            ret.put("wifiConnected", wifiConnected);
            ret.put("connectionType", connectionType);
            ret.put("wifiRssi", rssi);
            ret.put("wifiBars", wifiBarsFromRssi(rssi, wifiConnected));
            
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error getting device status", e);
            call.reject(e.getMessage());
        }
    }

    private static int readBatteryLevel(Context ctx) {
        // Method 1: BatteryManager (Preferred for API 21+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            if (bm != null) {
                int cap = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                if (cap >= 0 && cap <= 100) return cap;
            }
        }

        // Method 2: Sticky Broadcast (Fallback/Legacy)
        try {
            IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = ctx.registerReceiver(null, filter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0) {
                    return Math.round((level * 100f) / scale);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to read battery via broadcast", e);
        }
        
        return -1;
    }

    private static boolean readIsCharging(Context ctx) {
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent batteryStatus = ctx.registerReceiver(null, filter);
        if (batteryStatus == null) return false;
        int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        return status == BatteryManager.BATTERY_STATUS_CHARGING
            || status == BatteryManager.BATTERY_STATUS_FULL;
    }

    private static int wifiBarsFromRssi(int rssi, boolean connected) {
        if (!connected) return 0;
        // RSSI range is typically -100 to -50
        // We handle -127 as "unknown/bad"
        if (rssi <= -100 || rssi == -127) return 0;
        if (rssi >= -55) return 4;
        if (rssi >= -70) return 3;
        if (rssi >= -85) return 2;
        if (rssi >= -95) return 1;
        return 0;
    }
}
