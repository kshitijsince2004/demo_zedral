/**
 * SixHi stoppage codes — fetched from /6hi/master/stoppage-categories API.
 *
 * The static array has been replaced by a hook + cache that loads from the DB.
 * Components that previously imported `SixHi_STOPPAGE_CODES` directly should
 * now use the `useSixHiStoppageCodes()` hook instead.
 */

import { useState, useEffect } from 'react';
import { apiClient } from '../../lib/apiClient';

export interface SixHiStoppageCodeDef {
  displayCode: string;
  categoryCode: string;
  breakdownCode?: string;
  label: string;
  requiresReason?: boolean;
  requiresRollChange?: boolean;
}

// ─── Cached codes (shared across component instances) ─────────────────────────

let _cachedCodes: SixHiStoppageCodeDef[] | null = null;
let _loadPromise: Promise<SixHiStoppageCodeDef[]> | null = null;

async function loadStoppageCodes(): Promise<SixHiStoppageCodeDef[]> {
  if (_cachedCodes) return _cachedCodes;
  if (_loadPromise) return _loadPromise;

  _loadPromise = apiClient
    .get<Array<{ categoryCode: string; label: string; requiresBreakdownCode?: boolean }>>('/6hi/master/stoppage-categories')
    .then((data) => {
      const numeric = data.filter((cat) => /^\d{1,2}$/.test(cat.categoryCode));
      const source = numeric.length > 0 ? numeric : data;
      const codes: SixHiStoppageCodeDef[] = source.map((cat) => ({
        displayCode: /^\d{1,2}$/.test(cat.categoryCode) ? cat.categoryCode.padStart(2, '0') : cat.categoryCode,
        categoryCode: cat.categoryCode,
        label: cat.label,
        requiresReason: true,
        requiresRollChange: cat.categoryCode === '04',
      }));
      _cachedCodes = codes;
      return codes;
    })
    .catch(() => {
      // Fallback: return minimal defaults so UI doesn't break
      const fallback: SixHiStoppageCodeDef[] = [
        { displayCode: '01', categoryCode: '01', label: 'Mechanical', requiresReason: true },
        { displayCode: '04', categoryCode: '04', label: 'Work Roll Change', requiresReason: true, requiresRollChange: true },
        { displayCode: '11', categoryCode: '11', label: 'Power Failure', requiresReason: true },
        { displayCode: '12', categoryCode: '12', label: 'Operational', requiresReason: false },
      ];
      _cachedCodes = fallback;
      return fallback;
    })
    .finally(() => { _loadPromise = null; });

  return _loadPromise;
}

/** Backwards-compatible static export — eagerly populated from cache if available. */
export let SixHi_STOPPAGE_CODES: SixHiStoppageCodeDef[] = _cachedCodes ?? [
  { displayCode: '01', categoryCode: '01', label: 'Mechanical', requiresReason: true },
  { displayCode: '04', categoryCode: '04', label: 'Work Roll Change', requiresReason: true, requiresRollChange: true },
  { displayCode: '11', categoryCode: '11', label: 'Power Failure', requiresReason: true },
  { displayCode: '12', categoryCode: '12', label: 'Operational', requiresReason: false },
];

/** React hook — the preferred way to consume stoppage codes. */
export function useSixHiStoppageCodes() {
  const [codes, setCodes] = useState<SixHiStoppageCodeDef[]>(SixHi_STOPPAGE_CODES);
  const [loading, setLoading] = useState(!_cachedCodes);

  useEffect(() => {
    let cancelled = false;
    loadStoppageCodes().then((loaded) => {
      if (!cancelled) {
        setCodes(loaded);
        SixHi_STOPPAGE_CODES = loaded;
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { codes, loading };
}

export function resolveStoppageDisplayCode(categoryCode: string, breakdownCode?: string): string {
  const match = SixHi_STOPPAGE_CODES.find(
    (c) => c.categoryCode === categoryCode && (c.breakdownCode ?? null) === (breakdownCode ?? null),
  );
  return match?.displayCode ?? categoryCode;
}

export function findStoppageCodeDef(displayCode: string): SixHiStoppageCodeDef | undefined {
  return SixHi_STOPPAGE_CODES.find((c) => c.displayCode === displayCode);
}
