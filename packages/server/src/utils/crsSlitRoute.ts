/** Per-line CRS journey preference from slit flags (plan §4 / §8). */
export function resolveCrsSlitPreferredRoute(slit: {
  holdFlag?: boolean | null;
  forCtlFlag?: boolean | null;
  routeCode?: string | null;
}): 'LE' | 'PKG' | null {
  if (slit.holdFlag) return null;
  const code = (slit.routeCode ?? '').toUpperCase();
  if (slit.forCtlFlag || code === 'LE' || code === 'CTL') return 'LE';
  if (code === 'PKG' || code === 'Z') return 'PKG';
  return null;
}
