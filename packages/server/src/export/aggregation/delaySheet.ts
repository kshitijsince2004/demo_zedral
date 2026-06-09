import type { DelayLogEntry, ShiftCode } from '../types/rdm';
import type { StoppageEventRow } from '../read/types';
import { areaLabelFor } from './lineAreas';
import { SHIFTS } from './derivation';

const COMBINABLE_CODES = new Set(['LUNCH', 'SETTING', 'S_SETUP']);

function isCombinable(e: StoppageEventRow): boolean {
  const code = e.reasonCode.toUpperCase();
  return [...COMBINABLE_CODES].some((c) => code.includes(c));
}

/**
 * Builds DELAY sheet rows per §6.6.
 * One row per stoppage by default; LUNCH+SETTING pairs in the same area×shift merge.
 * Empty shift blocks emit NIL / NIL / NIL.
 */
export function buildDelayLog(
  stoppages: StoppageEventRow[],
  dates: string[],
): DelayLogEntry[] {
  const entries: DelayLogEntry[] = [];

  for (const date of dates) {
    for (const shift of SHIFTS) {
      const shiftEvents = stoppages.filter(
        (e) => e.prodDate === date && e.shiftCode === shift,
      );

      if (shiftEvents.length === 0) {
        entries.push(nilEntry(date, shift));
        continue;
      }

      const byArea = new Map<string, StoppageEventRow[]>();
      for (const e of shiftEvents) {
        const list = byArea.get(e.areaCode) ?? [];
        list.push(e);
        byArea.set(e.areaCode, list);
      }

      for (const [areaCode, events] of byArea) {
        entries.push(...emitAreaDelayRows(date, shift, areaCode, events));
      }
    }
  }

  return entries;
}

function emitAreaDelayRows(
  date: string,
  shift: ShiftCode,
  areaCode: string,
  events: StoppageEventRow[],
): DelayLogEntry[] {
  const combinable = events.filter(isCombinable);
  const standalone = events.filter((e) => !isCombinable(e));
  const rows: DelayLogEntry[] = standalone.map((e) => singleEntry(date, shift, areaCode, e));

  if (combinable.length === 1) {
    rows.push(singleEntry(date, shift, areaCode, combinable[0]));
  } else if (combinable.length > 1) {
    rows.push(compositeEntry(date, shift, areaCode, combinable));
  }

  return rows;
}

function nilEntry(date: string, shift: ShiftCode): DelayLogEntry {
  return {
    date,
    areaLabel: 'NIL',
    shift,
    minutes: null,
    agency: 'NIL',
    reason: 'NIL',
    isNil: true,
  };
}

function singleEntry(
  date: string,
  shift: ShiftCode,
  areaCode: string,
  e: StoppageEventRow,
): DelayLogEntry {
  return {
    date,
    areaLabel: areaLabelFor(areaCode),
    shift,
    minutes: e.minutes,
    agency: e.agencyCode,
    reason: formatReasonLabel(e),
  };
}

function compositeEntry(
  date: string,
  shift: ShiftCode,
  areaCode: string,
  events: StoppageEventRow[],
): DelayLogEntry {
  const minutesParts = events.map((e) => String(e.minutes));
  const reasonParts = events.map((e) => formatReasonLabel(e));
  const agencies = [...new Set(events.map((e) => e.agencyCode))];

  return {
    date,
    areaLabel: areaLabelFor(areaCode),
    shift,
    minutes: events.reduce((s, e) => s + e.minutes, 0),
    agency: agencies.length === 1 ? agencies[0] : agencies.join('+'),
    reason: `${minutesParts.join('+')} / ${reasonParts.join('+')}`,
  };
}

function formatReasonLabel(e: StoppageEventRow): string {
  const code = e.reasonCode.toUpperCase();
  if (code.includes('MATERIAL') || code === 'S_MAT' || code.includes('RMS')) return 'RMS';
  if (code.includes('WR') || code.includes('ROLL')) return 'W/R CHANGE';
  if (code.includes('LUNCH')) return 'LUNCH';
  if (code.includes('SETUP') || code.includes('SETTING')) return 'SETTING';
  return e.reasonLabel || e.reasonCode;
}
