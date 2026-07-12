import { db } from '../db';

export type CrmSubProcess = 'ROLLING' | 'SKIN_PASS';

export interface MachineRegistryEntry {
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
}

let cache: { loadedAt: number; entries: MachineRegistryEntry[] } | null = null;
const CACHE_MS = 30_000;

function normalizeCapabilities(
  machineCode: string,
  routes: Array<{ sub_process: string | null }>,
): { rolling: boolean; skinPass: boolean } {
  const subs = new Set(routes.map((r) => r.sub_process).filter(Boolean));
  return {
    rolling: subs.has('ROLLING'),
    skinPass: subs.has('SKIN_PASS'),
  };
}

export class MachineRegistryService {
  static invalidateCache(): void {
    cache = null;
  }

  static async getAll(includeOffline = false): Promise<MachineRegistryEntry[]> {
    const now = Date.now();
    if (cache && now - cache.loadedAt < CACHE_MS) {
      return includeOffline
        ? cache.entries
        : cache.entries.filter((m) => m.machineStatus !== 'OFFLINE');
    }

    const machines = await db.selectFrom('master.machine')
      .select([
        'machine_code',
        'name',
        'process_code',
        'machine_status',
        'machine_type',
        'department',
        'capacity_mt',
      ] as const)
      .orderBy('machine_code', 'asc')
      .execute();

    const routes = await db.selectFrom('master.route_code')
      .select(['machine_code', 'sub_process'])
      .where('machine_code', 'is not', null)
      .execute();

    const routesByMachine = new Map<string, Array<{ sub_process: string | null }>>();
    for (const r of routes) {
      if (!r.machine_code) continue;
      const list = routesByMachine.get(r.machine_code) ?? [];
      list.push({ sub_process: r.sub_process });
      routesByMachine.set(r.machine_code, list);
    }

    const entries: MachineRegistryEntry[] = machines.map((m) => {
      const caps = normalizeCapabilities(m.machine_code, routesByMachine.get(m.machine_code) ?? []);
      const processCode = m.process_code ?? null;
      return {
        machineCode: m.machine_code,
        name: m.name,
        processCode,
        machineStatus: m.machine_status ?? 'OPERATIONAL',
        machineType: m.machine_type ?? null,
        department: m.department ?? null,
        capacityMt: m.capacity_mt != null ? Number(m.capacity_mt) : null,
        rolling: caps.rolling,
        skinPass: caps.skinPass,
        isCrmMill: processCode === 'CRM' || processCode === 'ROLLING' || m.machine_type === 'CRM_ROLLING' || m.machine_type === 'CRM_SKIN_PASS' || m.machine_type === 'CRM_COMBO' || caps.rolling || caps.skinPass,
      };
    });

    cache = { loadedAt: now, entries };
    return includeOffline
      ? entries
      : entries.filter((m) => m.machineStatus !== 'OFFLINE');
  }

  static async getCrmMills(includeOffline = false): Promise<MachineRegistryEntry[]> {
    const all = await this.getAll(includeOffline);
    return all.filter((m) => m.isCrmMill || m.rolling || m.skinPass);
  }

  static async getMillsForSubProcess(subProcess: CrmSubProcess, includeOffline = false): Promise<string[]> {
    const all = await this.getAll(includeOffline);
    const filtered = all.filter((m) =>
      subProcess === 'ROLLING' ? m.rolling : m.skinPass
    );
    if (filtered.length > 0) {
      return filtered.map((m) => m.machineCode);
    }
    // Strict fallback if DB not configured yet
    return subProcess === 'ROLLING' ? ['6HI', '4HI'] : ['2HI', '4HI', '6HI'];
  }

  static async resolveMachineCode(raw: string): Promise<string | null> {
    const code = raw.trim().toUpperCase();
    if (!code) return null;
    const all = await this.getAll(true);
    const hit = all.find((m) => m.machineCode === code);
    if (!hit || hit.machineStatus === 'OFFLINE') return null;
    return hit.machineCode;
  }

  static async assertMachineForSubProcess(subProcess: CrmSubProcess, machineCode: string): Promise<string> {
    const resolved = await this.resolveMachineCode(machineCode);
    if (!resolved) throw new Error(`Unknown or inactive machine: ${machineCode}`);
    const allowed = await this.getMillsForSubProcess(subProcess);
    if (!allowed.includes(resolved)) {
      throw new Error(`${resolved} is not valid for ${subProcess.replace('_', ' ')}`);
    }
    return resolved;
  }

  static async getOperationalMachineCodes(scope: string[] | null): Promise<string[]> {
    const all = await this.getAll(false);
    const codes = all.map((m) => m.machineCode);
    if (scope === null) return codes;
    return codes.filter((c) => scope.includes(c));
  }
}
