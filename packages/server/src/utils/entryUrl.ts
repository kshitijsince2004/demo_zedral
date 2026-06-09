/**
 * Extracts the canonical process code from an entry capture URL.
 * Examples: `/entries/hrs` → `HRS`, `/api/entries/pkl` → `PKL`
 */
export function parseProcessCodeFromEntryUrl(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/entries\/([^/?#]+)/i);
  if (!match?.[1]) return null;
  const segment = match[1].toUpperCase();
  // Support optional chart sub-path: /entries/pkl/chart → PKL_CHART if needed later
  if (segment === 'CHART') return 'PKL_CHART';
  return segment;
}
