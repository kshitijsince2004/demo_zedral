import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zedral.m1operator',
  appName: 'Zedral Operator',
  webDir: 'dist-operator',
  server: {
    androidScheme: 'https',
    // ponytail: QA/API is HTTPS; cleartext/mixed-content off unless plant LAN is HTTP-only
    cleartext: false,
  },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#163328' },
    CapacitorSQLite: { androidIsEncryption: true },
  },
};

export default config;
