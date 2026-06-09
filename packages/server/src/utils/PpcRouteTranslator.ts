/**
 * Translates PPC concatenated route strings (e.g. SP4F4RFXCZ) to canonical dash-separated
 * internal routes. Route codes 4 and 6 are preserved independently (4HI vs 6HI).
 */

const MULTI_CHAR = ['LE', 'PKG'] as const;
const SINGLE_CHAR = new Set(['S', 'P', '4', '6', 'R', 'F', 'X', 'Y', 'Z', 'C']);

export interface TranslatedRoute {
  raw: string;
  canonical: string;
  codes: string[];
  rollingPassCount: number;
}

/** Tokenize concatenated PPC route e.g. SP4F4RFXCZ */
export function tokenizePpcRoute(routeRaw: string): string[] {
  const s = routeRaw.trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return [];

  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const mc of MULTI_CHAR) {
      if (s.slice(i, i + mc.length) === mc) {
        tokens.push(mc);
        i += mc.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = s[i];
    if (SINGLE_CHAR.has(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    i += 1;
  }
  return tokens;
}

/** Normalize route for journey storage; append PKG if missing */
export function translatePpcRoute(routeRaw: string): TranslatedRoute {
  const raw = routeRaw.trim().toUpperCase();
  const tokens = tokenizePpcRoute(raw);
  const rollingPassCount = tokens.filter((t) => t === '4' || t === '6').length;
  const codes = [...tokens];
  if (!codes.includes('PKG')) codes.push('PKG');
  return {
    raw,
    canonical: codes.join('-'),
    codes,
    rollingPassCount: Math.max(rollingPassCount, 1),
  };
}

/** Parse canonical or PPC format into steps for ProcessRouteService */
export function parseRouteForJourney(routeRaw: string): string {
  if (routeRaw.includes('-')) {
    return routeRaw
      .split('-')
      .map((t) => t.trim().toUpperCase())
      .join('-');
  }
  return translatePpcRoute(routeRaw).canonical;
}
