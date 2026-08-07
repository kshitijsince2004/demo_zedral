import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zedral.m1operator.debug',
  appName: 'Zedral Operator',
  webDir: 'dist-operator',
  server: {
    androidScheme: 'https',
    cleartext: true,
    url: 'https://51.21.24.75'
  },
  android: { allowMixedContent: true },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#163328' },
    CapacitorSQLite: { androidIsEncryption: true },
  },
};

export default config;
