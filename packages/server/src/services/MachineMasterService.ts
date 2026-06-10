import { sql } from 'kysely';
import { db } from '../db';
import { MachineRegistryService } from './MachineRegistryService';

export type MachineMasterInput = {
  machineCode: string;
  name: string;
  processCode?: string;
  machineType?: string;
  department?: string;
  capacityMt?: number;
  machineStatus?: 'OPERATIONAL' | 'MAINTENANCE' | 'OFFLINE';
  supportsRolling?: boolean;
  supportsSkinPass?: boolean;
};

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export class MachineMasterService {
  static async list(includeOffline = true) {
    const rows = await db.selectFrom('master.machine')
      .selectAll()
      .orderBy('machine_code', 'asc')
      .execute();

    const routes = await db.selectFrom('master.route_code')
      .select(['machine_code', 'sub_process'])
      .where('machine_code', 'is not', null)
      .execute();

    const caps = new Map<string, { rolling: boolean; skinPass: boolean }>();
    for (const r of routes) {
      if (!r.machine_code || !r.sub_process) continue;
      const prev = caps.get(r.machine_code) ?? { rolling: false, skinPass: false };
      if (r.sub_process === 'ROLLING') prev.rolling = true;
      if (r.sub_process === 'SKIN_PASS') prev.skinPass = true;
      caps.set(r.machine_code, prev);
    }

    return rows
      .filter((r) => includeOffline || (r.machine_status ?? 'OPERATIONAL') !== 'OFFLINE')
      .map((r) => ({
        machineCode: r.machine_code,
        name: r.name,
        processCode: r.process_code,
        machineStatus: r.machine_status ?? 'OPERATIONAL',
        machineType: r.machine_type ?? 'PLANT',
        department: r.department,
        capacityMt: r.capacity_mt != null ? Number(r.capacity_mt) : null,
        supportsRolling: caps.get(r.machine_code)?.rolling ?? false,
        supportsSkinPass: caps.get(r.machine_code)?.skinPass ?? false,
      }));
  }

  static async create(input: MachineMasterInput, userId: number): Promise<void> {
    const machineCode = normalizeCode(input.machineCode);
    if (!/^[A-Z0-9]{2,8}$/.test(machineCode)) {
      throw new Error('Machine code must be 2–8 alphanumeric characters');
    }
    if (!input.name?.trim()) throw new Error('Machine name is required');

    const existing = await db.selectFrom('master.machine')
      .select('machine_code')
      .where('machine_code', '=', machineCode)
      .executeTakeFirst();
    if (existing) throw new Error(`Machine ${machineCode} already exists`);

    const processCode = input.processCode?.trim().toUpperCase() || null;
    let processId: number | null = null;
    if (processCode) {
      const proc = await db.selectFrom('master.process')
        .select('process_id')
        .where('code', '=', processCode)
        .executeTakeFirst();
      processId = proc?.process_id ?? null;
    }

    await db.transaction().execute(async (trx) => {
      await trx.insertInto('master.machine')
        .values({
          machine_code: machineCode,
          name: input.name.trim(),
          process_id: processId,
          process_code: processCode,
          machine_status: input.machineStatus ?? 'OPERATIONAL',
          machine_type: input.machineType ?? (processCode === '6HI' ? 'CRM_COMBO' : 'PLANT'),
          department: input.department?.trim() || null,
          capacity_mt: input.capacityMt ?? null,
        })
        .execute();

      await this.syncRouteCapabilities(trx, machineCode, processCode, {
        rolling: input.supportsRolling ?? false,
        skinPass: input.supportsSkinPass ?? false,
      });
    });

    MachineRegistryService.invalidateCache();
    void userId;
  }

  static async update(machineCode: string, input: Partial<MachineMasterInput>): Promise<void> {
    const code = normalizeCode(machineCode);
    const existing = await db.selectFrom('master.machine')
      .selectAll()
      .where('machine_code', '=', code)
      .executeTakeFirst();
    if (!existing) throw new Error(`Machine not found: ${code}`);

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('master.machine')
        .set({
          name: input.name?.trim() ?? existing.name,
          process_code: input.processCode?.trim().toUpperCase() ?? existing.process_code,
          machine_status: input.machineStatus ?? existing.machine_status,
          machine_type: input.machineType ?? existing.machine_type,
          department: input.department !== undefined ? (input.department?.trim() || null) : existing.department,
          capacity_mt: input.capacityMt !== undefined ? input.capacityMt : existing.capacity_mt,
        })
        .where('machine_code', '=', code)
        .execute();

      if (input.supportsRolling !== undefined || input.supportsSkinPass !== undefined) {
        const routes = await trx.selectFrom('master.route_code')
          .select(['sub_process'])
          .where('machine_code', '=', code)
          .execute();
        const rolling = input.supportsRolling ?? routes.some((r) => r.sub_process === 'ROLLING');
        const skinPass = input.supportsSkinPass ?? routes.some((r) => r.sub_process === 'SKIN_PASS');
        await this.syncRouteCapabilities(trx, code, existing.process_code, { rolling, skinPass });
      }
    });

    MachineRegistryService.invalidateCache();
  }

  static async setStatus(machineCode: string, status: 'OPERATIONAL' | 'MAINTENANCE' | 'OFFLINE'): Promise<void> {
    const code = normalizeCode(machineCode);
    const updated = await db.updateTable('master.machine')
      .set({ machine_status: status })
      .where('machine_code', '=', code)
      .executeTakeFirst();
    if (!updated) throw new Error(`Machine not found: ${code}`);
    MachineRegistryService.invalidateCache();
  }

  private static async syncRouteCapabilities(
    trx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    machineCode: string,
    processCode: string | null,
    caps: { rolling: boolean; skinPass: boolean },
  ): Promise<void> {
    if (processCode !== '6HI' && !caps.rolling && !caps.skinPass) return;

    await trx.deleteFrom('master.route_code')
      .where('machine_code', '=', machineCode)
      .where('sub_process', 'in', ['ROLLING', 'SKIN_PASS'])
      .execute();

    const seqBase = machineCode.charCodeAt(0) + machineCode.charCodeAt(machineCode.length - 1);

    if (caps.rolling) {
      const routeCode = machineCode.length >= 2 ? machineCode.slice(0, 1) + machineCode.slice(-1) : `${machineCode}R`;
      await sql`
        INSERT INTO master.route_code (route_code, display_label, process_code, machine_code, sub_process, seq_hint)
        VALUES (
          ${routeCode.slice(0, 4)},
          ${`${machineCode} Rolling`},
          ${processCode ?? '6HI'},
          ${machineCode},
          'ROLLING',
          ${seqBase}
        )
        ON CONFLICT (route_code) DO UPDATE SET
          machine_code = EXCLUDED.machine_code,
          sub_process = EXCLUDED.sub_process,
          process_code = EXCLUDED.process_code,
          display_label = EXCLUDED.display_label
      `.execute(trx);
    }

    if (caps.skinPass) {
      const routeCode = `${machineCode}SP`.slice(0, 4);
      await sql`
        INSERT INTO master.route_code (route_code, display_label, process_code, machine_code, sub_process, seq_hint)
        VALUES (
          ${routeCode},
          ${`${machineCode} Skin Pass`},
          ${processCode ?? '6HI'},
          ${machineCode},
          'SKIN_PASS',
          ${seqBase + 1}
        )
        ON CONFLICT (route_code) DO UPDATE SET
          machine_code = EXCLUDED.machine_code,
          sub_process = EXCLUDED.sub_process,
          process_code = EXCLUDED.process_code,
          display_label = EXCLUDED.display_label
      `.execute(trx);
    }
  }
}
