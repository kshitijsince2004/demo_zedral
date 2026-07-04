import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zedral.m1operator',
  appName: 'Zedral M1 Operator',
  webDir: 'dist-operator',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#0f172a' },
    CapacitorSQLite: { androidIsEncryption: false },
  },
};

export default config;
