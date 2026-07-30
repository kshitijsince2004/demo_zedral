import { db } from '../db';

const k = db as any;

export class ProcessSheetService {
  static async list(filter?: { gradeCode?: string }) {
    let q = k
      .selectFrom('master.process_sheet as ps')
      .leftJoin('master.customer as c', 'c.customer_id', 'ps.customer_id')
      .select([
        'ps.process_sheet_id',
        'ps.grade_code',
        'ps.customer_id',
        'c.customer_name',
        'ps.route_code',
        'ps.title',
        'ps.status',
        'ps.is_active',
        'ps.notes',
        'ps.created_at',
      ])
      .where('ps.is_active', '=', true)
      .orderBy('ps.grade_code', 'asc');
    if (filter?.gradeCode) q = q.where('ps.grade_code', '=', filter.gradeCode);
    return q.execute();
  }

  static async getDetail(processSheetId: number) {
    const sheet = await k
      .selectFrom('master.process_sheet')
      .selectAll()
      .where('process_sheet_id', '=', processSheetId)
      .executeTakeFirst();
    if (!sheet) return null;
    const steps = await k
      .selectFrom('master.process_sheet_step as s')
      .selectAll()
      .where('s.process_sheet_id', '=', processSheetId)
      .orderBy('s.seq_no', 'asc')
      .execute();
    const checks = await k
      .selectFrom('master.process_sheet_step_check as c')
      .innerJoin('master.process_sheet_step as s', 's.step_id', 'c.step_id')
      .select(['c.step_id', 'c.parameter_code', 'c.is_mandatory', 's.process_code'])
      .where('s.process_sheet_id', '=', processSheetId)
      .execute();
    return { sheet, steps, checks };
  }

  static async create(
    body: {
      gradeCode: string;
      customerId?: number | null;
      routeCode?: string | null;
      title?: string | null;
      notes?: string | null;
      steps?: Array<{ processCode: string; seqNo: number; stepLabel?: string; parameterCodes?: string[] }>;
    },
    userId: string,
  ) {
    const sheet = await k
      .insertInto('master.process_sheet')
      .values({
        grade_code: body.gradeCode,
        customer_id: body.customerId ?? null,
        route_code: body.routeCode ?? null,
        title: body.title ?? null,
        notes: body.notes ?? null,
        status: 'DRAFT',
        created_by: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const step of body.steps ?? []) {
      const row = await k
        .insertInto('master.process_sheet_step')
        .values({
          process_sheet_id: sheet.process_sheet_id,
          seq_no: step.seqNo,
          process_code: step.processCode.toUpperCase(),
          step_label: step.stepLabel ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      for (const code of step.parameterCodes ?? []) {
        await k
          .insertInto('master.process_sheet_step_check')
          .values({
            step_id: row.step_id,
            parameter_code: code,
            is_mandatory: false,
          })
          .execute();
      }
    }
    return this.getDetail(Number(sheet.process_sheet_id));
  }

  static async setStepChecks(stepId: number, parameterCodes: string[]) {
    await k.deleteFrom('master.process_sheet_step_check').where('step_id', '=', stepId).execute();
    for (const code of parameterCodes) {
      await k
        .insertInto('master.process_sheet_step_check')
        .values({ step_id: stepId, parameter_code: code, is_mandatory: false })
        .execute();
    }
    return k
      .selectFrom('master.process_sheet_step_check')
      .selectAll()
      .where('step_id', '=', stepId)
      .execute();
  }

  static async publish(processSheetId: number) {
    const sheet = await k
      .selectFrom('master.process_sheet')
      .selectAll()
      .where('process_sheet_id', '=', processSheetId)
      .executeTakeFirst();
    if (!sheet) throw new Error('Process sheet not found');

    await k
      .updateTable('master.process_sheet')
      .set({ status: 'RETIRED' })
      .where('grade_code', '=', sheet.grade_code)
      .where('status', '=', 'ACTIVE')
      .where('process_sheet_id', '!=', processSheetId)
      .where((eb: any) =>
        sheet.customer_id == null
          ? eb('customer_id', 'is', null)
          : eb('customer_id', '=', sheet.customer_id),
      )
      .execute();

    return k
      .updateTable('master.process_sheet')
      .set({ status: 'ACTIVE' })
      .where('process_sheet_id', '=', processSheetId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  static async retire(processSheetId: number) {
    return k
      .updateTable('master.process_sheet')
      .set({ status: 'RETIRED', is_active: false })
      .where('process_sheet_id', '=', processSheetId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Parameter codes inspected at a process step for grade (+ optional customer). */
  static async checksForProcess(
    gradeCode: string,
    processCode: string,
    customerId?: number | null,
  ): Promise<string[] | null> {
    if (!gradeCode || !processCode) return null;
    let q = k
      .selectFrom('master.process_sheet as ps')
      .innerJoin('master.process_sheet_step as s', 's.process_sheet_id', 'ps.process_sheet_id')
      .innerJoin('master.process_sheet_step_check as c', 'c.step_id', 's.step_id')
      .select('c.parameter_code')
      .where('ps.status', '=', 'ACTIVE')
      .where('ps.is_active', '=', true)
      .where('ps.grade_code', '=', gradeCode)
      .where('s.process_code', '=', processCode.toUpperCase());

    if (customerId != null) {
      q = q.where((eb: any) =>
        eb.or([eb('ps.customer_id', '=', customerId), eb('ps.customer_id', 'is', null)]),
      );
    } else {
      q = q.where('ps.customer_id', 'is', null);
    }

    const rows = await q.orderBy('ps.customer_id', 'desc').execute();
    if (!rows.length) return null;
    const codes: string[] = [];
    for (const r of rows) {
      const code = String((r as { parameter_code: string }).parameter_code);
      if (!codes.includes(code)) codes.push(code);
    }
    return codes;
  }
}
