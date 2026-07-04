/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __OPERATOR_BUILD__: boolean | undefined;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_VERSION?: string;
}
