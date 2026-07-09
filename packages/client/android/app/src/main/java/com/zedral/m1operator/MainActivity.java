package com.zedral.m1operator;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    SplashScreen.installSplashScreen(this);
    super.onCreate(savedInstanceState);
    registerPlugin(KioskPlugin.class);
    registerPlugin(DeviceStatusPlugin.class);

    // Ensure hardware acceleration is enabled at the window level to mitigate some MTK driver issues
    getWindow().setFlags(
      WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
    );

    // Compatibility for API < 27 for attributes in manifest
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    }

    DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
    if (dpm != null) {
      ComponentName admin = new ComponentName(this, KioskAdminReceiver.class);
      if (dpm.isDeviceOwnerApp(getPackageName())) {
        dpm.setLockTaskPackages(admin, new String[]{ getPackageName() });
      }
    }
    try {
      startLockTask();
    } catch (Exception e) {
      // Log or handle case where lock task is not allowed
    }
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      hideSystemUI();
    }
  }

  private void hideSystemUI() {
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    controller.hide(WindowInsetsCompat.Type.systemBars());
  }
}
