package com.zedral.m1operator;

import android.app.Activity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {

    @PluginMethod
    public void exitKiosk(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is null");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                activity.stopLockTask();
                // After stopping lock task, finish the activity to close the app
                activity.finishAndRemoveTask();
                call.resolve();
            } catch (SecurityException e) {
                call.reject("Security error: App is not in lock task mode or not allowed to exit.");
            } catch (Exception e) {
                call.reject("Failed to exit kiosk mode: " + e.getMessage());
            }
        });
    }
}
