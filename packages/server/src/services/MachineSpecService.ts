import { db } from '../db';

export type MachineSpecStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';

export type MachineSpecInput = {
  machineCode: string;
  widthMinMm?: number | null;
  widthMaxMm?: number | null;
  thkMinMm?: number | null;
  thkMaxMm?: number | null;
  mandrelIds?: number[];
  coilWtMinMt?: number | null;
  coilWtMaxMt?: number | null;
  exitOdMaxMm?: number | null;
  lineSpeedMpm?: number | null;
  cutterDiaMm?: number | null;
  airMode?: string | null;
  notes?: string | null;
};

export type MachineSpecView = {
  specId: string;
  machineCode: string;
  rev: number;
  status: MachineSpecStatus;
  widthMinMm: number | null;
  widthMaxMm: number | null;
  thkMinMm: number | null;
  thkMaxMm: number | null;
  mandrelIds: number[];
  coilWtMinMt: number | null;
  coilWtMaxMt: number | null;
  exitOdMaxMm: number | null;
  lineSpeedMpm: number | null;
  cutterDiaMm: number | null;
  airMode: string | null;
  isReferenceSeed: boolean;
  notes: string | null;
  activatedAt: string | null;
};

function toView(row: Record<string, unknown>): MachineSpecView {
  const ids = row.mandrel_ids;
  const mandrelIds = Array.isArray(ids)
    ? ids.map(Number).filter((n) => Number.isFinite(n))
    : typeof ids === 'string'
      ? (JSON.parse(ids) as number[])
      : [];
  return {
    specId: String(row.spec_id),
    machineCode: String(row.machine_code),
    rev: Number(row.rev),
    status: row.status as MachineSpecStatus,
    widthMinMm: row.width_min_mm != null ? Number(row.width_min_mm) : null,
    widthMaxMm: row.width_max_mm != null ? Number(row.width_max_mm) : null,
    thkMinMm: row.thk_min_mm != null ? Number(row.thk_min_mm) : null,
    thkMaxMm: row.thk_max_mm != null ? Number(row.thk_max_mm) : null,
    mandrelIds,
    coilWtMinMt: row.coil_wt_min_mt != null ? Number(row.coil_wt_min_mt) : null,
    coilWtMaxMt: row.coil_wt_max_mt != null ? Number(row.coil_wt_max_mt) : null,
    exitOdMaxMm: row.exit_od_max_mm != null ? Number(row.exit_od_max_mm) : null,
    lineSpeedMpm: row.line_speed_mpm != null ? Number(row.line_speed_mpm) : null,
    cutterDiaMm: row.cutter_dia_mm != null ? Number(row.cutter_dia_mm) : null,
    airMode: row.air_mode != null ? String(row.air_mode) : null,
    isReferenceSeed: Boolean(row.is_reference_seed),
    notes: row.notes != null ? String(row.notes) : null,
    activatedAt: row.activated_at ? new Date(row.activated_at as string | Date).toISOString() : null,
  };
}

export class MachineSpecService {
  static async list(machineCode?: string): Promise<MachineSpecView[]> {
    let q = db.selectFrom('master.machine_spec').selectAll().orderBy('machine_code').orderBy('rev', 'desc');
    if (machineCode) q = q.where('machine_code', '=', machineCode.toUpperCase());
    const rows = await q.execute();
    return rows.map((r) => toView(r as unknown as Record<string, unknown>));
  }

  static async getActive(machineCode: string): Promise<MachineSpecView | null> {
    const row = await db.selectFrom('master.machine_spec')
      .selectAll()
      .where('machine_code', '=', machineCode.toUpperCase())
      .where('status', '=', 'ACTIVE')
      .orderBy('rev', 'desc')
      .executeTakeFirst();
    return row ? toView(row as unknown as Record<string, unknown>) : null;
  }

  static async createDraft(input: MachineSpecInput, userId?: number): Promise<MachineSpecView> {
    const code = input.machineCode.trim().toUpperCase();
    const last = await db.selectFrom('master.machine_spec')
      .select('rev')
      .where('machine_code', '=', code)
      .orderBy('rev', 'desc')
      .executeTakeFirst();
    const rev = (last?.rev ?? 0) + 1;
    const row = await db.insertInto('master.machine_spec')
      .values({
        machine_code: code,
        rev,
        status: 'DRAFT',
        width_min_mm: input.widthMinMm ?? null,
        width_max_mm: input.widthMaxMm ?? null,
        thk_min_mm: input.thkMinMm ?? null,
        thk_max_mm: input.thkMaxMm ?? null,
        mandrel_ids: (input.mandrelIds ?? []) as unknown as string,
        coil_wt_min_mt: input.coilWtMinMt ?? null,
        coil_wt_max_mt: input.coilWtMaxMt ?? null,
        exit_od_max_mm: input.exitOdMaxMm ?? null,
        line_speed_mpm: input.lineSpeedMpm ?? null,
        cutter_dia_mm: input.cutterDiaMm ?? null,
        air_mode: input.airMode ?? null,
        notes: input.notes ?? null,
        created_by: userId ?? null,
        is_reference_seed: false,
      } as never)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toView(row as unknown as Record<string, unknown>);
  }

  static async activate(specId: string): Promise<MachineSpecView> {
    const current = await db.selectFrom('master.machine_spec')
      .selectAll()
      .where('spec_id', '=', specId)
      .executeTakeFirst();
    if (!current) throw new Error('Spec not found');
    if (current.status === 'SUPERSEDED') throw new Error('Cannot activate superseded spec');

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('master.machine_spec')
        .set({ status: 'SUPERSEDED' })
        .where('machine_code', '=', current.machine_code)
        .where('status', '=', 'ACTIVE')
        .execute();
      await trx.updateTable('master.machine_spec')
        .set({ status: 'ACTIVE', activated_at: new Date() })
        .where('spec_id', '=', specId)
        .execute();
    });

    const row = await db.selectFrom('master.machine_spec').selectAll().where('spec_id', '=', specId).executeTakeFirstOrThrow();
    return toView(row as unknown as Record<string, unknown>);
  }
}
