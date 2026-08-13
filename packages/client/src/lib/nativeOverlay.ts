import { Capacitor } from '@capacitor/core';

/** Overlay class: solid on native (no blur cost); blur OK on desktop. */
export function overlayClass(base: string, blurClass: string): string {
  return Capacitor.isNativePlatform() ? base : `${base} ${blurClass}`;
}
