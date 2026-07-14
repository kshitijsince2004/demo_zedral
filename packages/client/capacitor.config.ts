import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zedral.m1operator',
  appName: 'Zedral Operator',
  webDir: 'dist-operator',
  server: { androidScheme: 'http', cleartext: true },
  android: { allowMixedContent: true },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#163328' },
    CapacitorSQLite: { androidIsEncryption: false },
  },
};

export default config;
