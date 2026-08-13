package com.zedral.m1operator;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
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
            // Optimization: Single battery read from sticky broadcast
            IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = ctx.registerReceiver(null, filter);
            
            int batteryLevel = -1;
            boolean isCharging = false;
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0) {
                    batteryLevel = Math.round((level * 100f) / scale);
                }
                int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
            }

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
                }
                
                // Optimized fallback: Only search other networks if active is not WiFi
                if (!wifiConnected) {
                    for (Network network : cm.getAllNetworks()) {
                        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
                        if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                            wifiConnected = true;
                            connectionType = "wifi";
                            break;
                        }
                    }
                }
            }

            if (wifiConnected) {
                WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    // Note: getConnectionInfo() can be slow; consider using NetworkCallback in a future refactor
                    WifiInfo info = wm.getConnectionInfo();
                    if (info != null) {
                        rssi = info.getRssi();
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

    private static int wifiBarsFromRssi(int rssi, boolean connected) {
        if (!connected) return 0;
        if (rssi <= -100 || rssi == -127) return 0;
        if (rssi >= -55) return 4;
        if (rssi >= -70) return 3;
        if (rssi >= -85) return 2;
        if (rssi >= -95) return 1;
        return 0;
    }
}
