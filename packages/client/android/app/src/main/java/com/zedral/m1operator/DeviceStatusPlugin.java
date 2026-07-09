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
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DeviceStatus")
public class DeviceStatusPlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("Context unavailable");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("batteryLevel", readBatteryLevel(ctx));
        ret.put("isCharging", readIsCharging(ctx));

        boolean wifiConnected = false;
        String connectionType = "unknown";
        int rssi = -127;

        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
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
                    } else if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                        connectionType = "none";
                    }
                }
            } else {
                connectionType = "none";
            }
        }

        if (wifiConnected) {
            WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
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
    }

    private static int readBatteryLevel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            if (bm != null) {
                return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            }
        }
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent batteryStatus = ctx.registerReceiver(null, filter);
        if (batteryStatus == null) return -1;
        int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        if (level < 0 || scale <= 0) return -1;
        return Math.round((level * 100f) / scale);
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
        if (!connected || rssi <= -127) return 0;
        if (rssi >= -55) return 4;
        if (rssi >= -66) return 3;
        if (rssi >= -77) return 2;
        if (rssi >= -88) return 1;
        return 0;
    }
}
