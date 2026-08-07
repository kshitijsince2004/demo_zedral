import { useEffect, useState } from 'react';
import { apiClient } from './apiClient';
import type { SixHiStoppageCodeDef } from '../components/sixHi/SixHiStoppageCodes';

/** Map UI / PREFIX-* code → txn.stoppage.category_code (01–16 style). */
export function toStoppageCategoryCode(code: string): string {
  const trimmed = code.trim();
  const m = trimmed.match(/^(?:[A-Z]+-)?(\d{1,2})$/i);
  if (m) return m[1].padStart(2, '0');
  return trimmed;
}

const _cacheByMachine = new Map<string, SixHiStoppageCodeDef[]>();
const _loadByMachine = new Map<string, Promise<SixHiStoppageCodeDef[]>>();

async function loadMachineStoppageCodes(machine: string): Promise<SixHiStoppageCodeDef[]> {
  const key = machine.trim().toUpperCase();
  const cached = _cacheByMachine.get(key);
  if (cached) return cached;

  const inflight = _loadByMachine.get(key);
  if (inflight) return inflight;

  const promise = apiClient
    .get<{ codes: Array<{ stoppageCode: string; description: string }> }>(
      `/stations/stoppage-codes?machine=${encodeURIComponent(key)}`,
    )
    .then((data) => {
      const codes: SixHiStoppageCodeDef[] = (data.codes ?? []).map((row) => {
        const display = row.stoppageCode;
        const categoryCode = toStoppageCategoryCode(display);
        return {
          displayCode: display,
          categoryCode,
          label: row.description || display,
          requiresReason: true,
          // CRM work-roll change (legacy category 04)
          requiresRollChange: categoryCode === '04',
        };
      });
      _cacheByMachine.set(key, codes);
      return codes;
    })
    .catch(() => {
      // Fallback keeps UI usable offline; empty list if machine has no catalogue
      return [] as SixHiStoppageCodeDef[];
    })
    .finally(() => {
      _loadByMachine.delete(key);
    });

  _loadByMachine.set(key, promise);
  return promise;
}

/** Stoppage catalogue filtered by Master Data machine classification. */
export function useMachineStoppageCodes(machine: string | undefined | null) {
  const key = (machine ?? '').trim().toUpperCase();
  const [codes, setCodes] = useState<SixHiStoppageCodeDef[]>(() => _cacheByMachine.get(key) ?? []);
  const [loading, setLoading] = useState(Boolean(key) && !_cacheByMachine.has(key));

  useEffect(() => {
    if (!key) {
      setCodes([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(!_cacheByMachine.has(key));
    void loadMachineStoppageCodes(key).then((next) => {
      if (!cancelled) {
        setCodes(next);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [key]);

  return { codes, loading };
}

/** @deprecated use useMachineStoppageCodes('PKL') */
export function usePklStoppageCodes() {
  return useMachineStoppageCodes('PKL');
}
