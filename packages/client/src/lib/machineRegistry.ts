import { apiClient } from './apiClient';

export type MachineRegistryEntry = {
  machineCode: string;
  name: string;
  processCode: string | null;
  machineStatus: string;
  machineType: string | null;
  department: string | null;
  capacityMt: number | null;
  rolling: boolean;
  skinPass: boolean;
  isCrmMill: boolean;
};

let cache: { loadedAt: number; machines: MachineRegistryEntry[] } | null = null;
const CACHE_MS = 30_000;

export async function fetchMachineRegistry(force = false): Promise<MachineRegistryEntry[]> {
  const now = Date.now();
  if (!force && cache && now - cache.loadedAt < CACHE_MS) {
    return cache.machines;
  }
  const res = await apiClient.get<{ machines: MachineRegistryEntry[] }>('/machines/registry');
  cache = { loadedAt: now, machines: res.machines };
  return res.machines;
}

export function invalidateMachineRegistryCache(): void {
  cache = null;
}

export async function millsForSubProcessFromRegistry(
  subProcess: 'ROLLING' | 'SKIN_PASS',
): Promise<string[]> {
  const machines = await fetchMachineRegistry();
  const filtered = machines.filter((m) => (subProcess === 'ROLLING' ? m.rolling : m.skinPass));
  if (filtered.length > 0) return filtered.map((m) => m.machineCode);
  return subProcess === 'ROLLING' ? ['6HI', '4HI'] : ['2HI', '4HI', '6HI'];
}
