import { sql } from 'kysely';
import { db } from '../db';

export interface MachineCrewMember {
  id: string;
  machineCode: string;
  memberName: string;
  roleLabel: string;
}

export class MachineCrewService {
  /** Short-lived cache so operator-name fallback doesn't N+1 the roster per row. */
  private static operatorCache = new Map<string, { name: string | undefined; at: number }>();

  /**
   * Operator-role member from the crew register for a machine — used as the
   * display fallback when an order has no logged_in_user_id. Never returns a
   * placeholder; callers decide the final blank-safe value.
   */
  static async getOperatorName(machineCode: string): Promise<string | undefined> {
    const cached = this.operatorCache.get(machineCode);
    if (cached && Date.now() - cached.at < 60_000) return cached.name;

    const rows = await db
      .selectFrom('master.machine_crew_roster')
      .select(['member_name', 'role_label'])
      .where('machine_code', '=', machineCode)
      .where('is_active', '=', true)
      .orderBy('member_name', 'asc')
      .execute();

    const operator = rows.find((r) => /operator/i.test(r.role_label ?? '')) ?? rows[0];
    const name = operator?.member_name?.trim() || undefined;
    this.operatorCache.set(machineCode, { name, at: Date.now() });
    return name;
  }

  static async list(machineCode: string): Promise<MachineCrewMember[]> {
    const rows = await db
      .selectFrom('master.machine_crew_roster')
      .select(['crew_id', 'machine_code', 'member_name', 'role_label'])
      .where('machine_code', '=', machineCode)
      .where('is_active', '=', true)
      .orderBy('member_name', 'asc')
      .execute();

    return rows.map((r) => ({
      id: String(r.crew_id),
      machineCode: r.machine_code,
      memberName: r.member_name,
      roleLabel: r.role_label,
    }));
  }

  static async create(payload: { machineCode: string; memberName: string; roleLabel: string }) {
    const name = payload.memberName.trim();
    const role = payload.roleLabel.trim();
    if (!name) throw new Error('Member name is required');
    if (!role) throw new Error('Role is required');

    const row = await db
      .insertInto('master.machine_crew_roster')
      .values({
        machine_code: payload.machineCode,
        member_name: name,
        role_label: role,
      })
      .returning('crew_id')
      .executeTakeFirstOrThrow();

    return String(row.crew_id);
  }

  static async update(
    crewId: string,
    payload: { machineCode: string; memberName?: string; roleLabel?: string },
  ) {
    const existing = await db
      .selectFrom('master.machine_crew_roster')
      .select(['crew_id'])
      .where('crew_id', '=', crewId)
      .where('machine_code', '=', payload.machineCode)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!existing) throw new Error('Crew member not found');

    const updates: Record<string, unknown> = { updated_at: sql`now()` };
    if (payload.memberName != null) {
      const name = payload.memberName.trim();
      if (!name) throw new Error('Member name is required');
      updates.member_name = name;
    }
    if (payload.roleLabel != null) {
      const role = payload.roleLabel.trim();
      if (!role) throw new Error('Role is required');
      updates.role_label = role;
    }

    await db
      .updateTable('master.machine_crew_roster')
      .set(updates)
      .where('crew_id', '=', crewId)
      .execute();
  }

  static async remove(crewId: string, machineCode: string) {
    const result = await db
      .updateTable('master.machine_crew_roster')
      .set({ is_active: false, updated_at: sql`now()` })
      .where('crew_id', '=', crewId)
      .where('machine_code', '=', machineCode)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
      throw new Error('Crew member not found');
    }
  }
}
