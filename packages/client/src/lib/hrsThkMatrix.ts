export type ThkPass = { time: string; bySlot: Record<string, string> };

/** Keep in-progress decimals ("2.", ".5") instead of coercing on each keystroke. */
export function sanitizeDecimalInput(raw: string): string {
  const t = raw.replace(/[^\d.]/g, '');
  const dot = t.indexOf('.');
  if (dot < 0) return t;
  return `${t.slice(0, dot + 1)}${t.slice(dot + 1).replace(/\./g, '')}`;
}

export function parseDecimalInput(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const t = raw.trim();
  if (!t || t === '.') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function latestByTime<T extends { time: string }>(readings: T[]): T | undefined {
  if (!readings.length) return undefined;
  return [...readings].sort((a, b) => a.time.localeCompare(b.time)).at(-1);
}

/** Matrix rows → per-slot readings. Empty / non-positive cells omitted. */
export function thkPassesToSlotReadings(
  passes: ThkPass[],
  slot: string,
): { time: string; thkMm: number }[] {
  return passes.flatMap((p) => {
    const time = p.time.trim();
    const thkMm = parseDecimalInput(p.bySlot[slot]);
    if (!time || thkMm == null) return [];
    return [{ time, thkMm }];
  });
}

/** Saved per-slot readings → matrix rows (inverse of thkPassesToSlotReadings). */
export function slotReadingsToThkPasses(
  slots: Array<{ slot: string; readings: { time: string; thkMm: number }[] }>,
): ThkPass[] {
  const byTime = new Map<string, Record<string, string>>();
  for (const s of slots) {
    for (const r of s.readings) {
      const time = r.time.trim();
      if (!time || !Number.isFinite(r.thkMm) || r.thkMm <= 0) continue;
      const row = byTime.get(time) ?? {};
      row[s.slot] = String(r.thkMm);
      byTime.set(time, row);
    }
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, bySlot]) => ({ time, bySlot }));
}

export function cleanTaperReadings(
  readings: { time: string; taper: string }[],
): { time: string; taper: string }[] {
  return readings
    .map((r) => ({ time: r.time.trim(), taper: r.taper.trim() }))
    .filter((r) => !!r.time && !!r.taper);
}
