import type { MachineAccessEntry } from '@m1/shared-validation';
import { db } from '../db';
import type { LineAccessInput } from './UserService';

const VALID_LEVELS = new Set(['READ', 'WRITE', 'APPROVE']);

async function resolveProcessId(processCode: string): Promise<number> {
  const process = await db
    .selectFrom('master.process')
    .select('process_id')
    .where('code', '=', processCode.toUpperCase())
    .executeTakeFirst();
  if (!process) throw new Error(`Unknown process line: ${processCode}`);
  return process.process_id;
}

/** Derive security.line_access rows from assigned machines (mills map to 6HI process). */
export function lineAccessFromMachines(machineCodes: string[]): LineAccessInput[] {
  const lines = new Set<string>();
  for (const code of machineCodes) {
    if (code === '4HI' || code === '2HI') lines.add('6HI');
    else lines.add(code);
  }
  return [...lines].map((line_id) => ({ line_id, level: 'WRITE' }));
}

async function replaceLineAccess(userId: number, lineAccess: LineAccessInput[]) {
  await db.deleteFrom('security.line_access').where('user_id', '=', userId).execute();
  for (const entry of lineAccess) {
    const level = entry.level.toUpperCase();
    if (!VALID_LEVELS.has(level)) throw new Error(`Invalid access level: ${entry.level}`);
    const processId = await resolveProcessId(entry.line_id);
    await db.insertInto('security.line_access').values({
      user_id: userId,
      process_id: processId,
      access_level: level,
    }).execute();
  }
}

export class MachineAccessService {
  static async list(): Promise<MachineAccessEntry[]> {
    const users = await db.selectFrom('security.app_user')
      .select(['user_id', 'username', 'full_name'])
      .orderBy('username', 'asc')
      .execute();

    const roles = await db.selectFrom('security.user_role')
      .innerJoin('security.role', 'security.role.role_id', 'security.user_role.role_id')
      .select(['security.user_role.user_id', 'security.role.role_name'])
      .execute();
    const roleByUser = new Map(roles.map((r) => [r.user_id, r.role_name]));

    const access = await db.selectFrom('security.machine_access as ma')
      .innerJoin('master.machine as m', 'm.machine_code', 'ma.machine_code')
      .select(['ma.user_id', 'ma.machine_code', 'm.name', 'ma.access_level'])
      .execute();

    const lineRows = await db.selectFrom('security.line_access')
      .innerJoin('master.process', 'security.line_access.process_id', 'master.process.process_id')
      .select(['security.line_access.user_id', 'master.process.code', 'security.line_access.access_level'])
      .execute();

    const byUser = new Map<number, MachineAccessEntry>();

    for (const u of users) {
      byUser.set(u.user_id, {
        userId: String(u.user_id),
        username: u.username,
        displayName: u.full_name,
        role: roleByUser.get(u.user_id),
        machines: [],
        lineAccess: [],
      });
    }

    for (const a of access) {
      const entry = byUser.get(a.user_id);
      if (!entry) continue;
      entry.machines.push({
        machineCode: a.machine_code,
        machineName: a.name,
        accessLevel: a.access_level,
      });
    }

    for (const la of lineRows) {
      const entry = byUser.get(la.user_id);
      if (!entry) continue;
      entry.lineAccess.push({
        lineId: la.code,
        level: la.access_level,
      });
    }

    return [...byUser.values()];
  }

  static async getForUser(userId: number): Promise<string[]> {
    const rows = await db.selectFrom('security.machine_access')
      .select('machine_code')
      .where('user_id', '=', userId)
      .execute();
    return rows.map((r) => r.machine_code);
  }

  static async setForUser(userId: number, machineCodes: string[], assignedBy: number) {
    await db.deleteFrom('security.machine_access').where('user_id', '=', userId).execute();

    const valid = machineCodes.length === 0
      ? []
      : await db.selectFrom('master.machine')
          .select('machine_code')
          .where('machine_code', 'in', machineCodes)
          .execute();
    const validCodes = valid.map((v) => v.machine_code);

    if (validCodes.length > 0) {
      await db.insertInto('security.machine_access')
        .values(validCodes.map((machine_code) => ({
          user_id: userId,
          machine_code,
          access_level: 'MANAGE',
          assigned_by: assignedBy,
        })))
        .execute();
    }

    await replaceLineAccess(userId, lineAccessFromMachines(validCodes));
  }
}
