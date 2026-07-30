import { db } from '../db';
import { SpecResolverService } from './SpecResolverService';

const k = db as any;

export class QualitySpecService {
  static async listParameters() {
    return k
      .selectFrom('master.spec_parameter')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('sort_order', 'asc')
      .execute();
  }

  static async upsertParameter(body: Record<string, unknown>) {
    const code = String(body.parameterCode ?? body.parameter_code ?? '').trim();
    if (!code) throw new Error('parameterCode required');
    const values = {
      parameter_code: code,
      label: String(body.label ?? code),
      unit: body.unit != null ? String(body.unit) : null,
      data_type: String(body.dataType ?? body.data_type ?? 'NUMERIC'),
      limit_kind: String(body.limitKind ?? body.limit_kind ?? 'MIN_MAX'),
      param_group: body.group != null ? String(body.group) : body.param_group != null ? String(body.param_group) : null,
      applies_to: Array.isArray(body.appliesTo)
        ? body.appliesTo
        : Array.isArray(body.applies_to)
          ? body.applies_to
          : ['ALL'],
      sort_order: Number(body.sortOrder ?? body.sort_order ?? 0),
      is_mandatory_default: Boolean(body.isMandatoryDefault ?? body.is_mandatory_default ?? false),
      is_active: body.isActive === false || body.is_active === false ? false : true,
    };
    await k
      .insertInto('master.spec_parameter')
      .values(values)
      .onConflict((oc: any) => oc.column('parameter_code').doUpdateSet(values))
      .execute();
    return k.selectFrom('master.spec_parameter').selectAll().where('parameter_code', '=', code).executeTakeFirst();
  }

  static async listSpecs(filter: { gradeCode?: string; customerId?: number; status?: string }) {
    let q = k
      .selectFrom('master.spec_sheet as s')
      .leftJoin('master.spec_sheet_version as v', (join: any) =>
        join.onRef('v.spec_sheet_id', '=', 's.spec_sheet_id').on('v.status', '=', 'ACTIVE'),
      )
      .leftJoin('master.customer as c', 'c.customer_id', 's.customer_id')
      .select([
        's.spec_sheet_id',
        's.grade_code',
        's.material_code',
        's.surface_finish',
        's.width_mm',
        's.finish_thk_mm',
        's.length_mm',
        's.customer_id',
        'c.customer_name',
        's.title',
        's.is_active',
        'v.version_id as active_version_id',
        'v.version_no as active_version_no',
        'v.status as active_status',
      ])
      .orderBy('s.grade_code', 'asc');
    if (filter.gradeCode) q = q.where('s.grade_code', '=', filter.gradeCode);
    if (filter.customerId != null) q = q.where('s.customer_id', '=', filter.customerId);
    if (filter.status === 'ACTIVE') q = q.where('v.status', '=', 'ACTIVE');
    return q.execute();
  }

  static async createSpec(body: Record<string, unknown>, userId: string) {
    const gradeCode = String(body.gradeCode ?? body.grade_code ?? '').trim();
    if (!gradeCode) throw new Error('gradeCode required');
    const materialCode = String(body.materialCode ?? body.material_code ?? '');
    const surfaceFinish = body.surfaceFinish ?? body.surface_finish ?? null;
    const widthMm = body.widthMm ?? body.width_mm ?? null;
    const finishThkMm = body.finishThkMm ?? body.finish_thk_mm ?? null;
    const lengthMm = body.lengthMm ?? body.length_mm ?? null;
    const customerId = body.customerId ?? body.customer_id ?? null;

    const existing = await k
      .selectFrom('master.spec_sheet')
      .select('spec_sheet_id')
      .where('grade_code', '=', gradeCode)
      .where('material_code', '=', materialCode)
      .where((eb: any) =>
        surfaceFinish == null
          ? eb('surface_finish', 'is', null)
          : eb('surface_finish', '=', String(surfaceFinish)),
      )
      .where((eb: any) => (widthMm == null ? eb('width_mm', 'is', null) : eb('width_mm', '=', widthMm)))
      .where((eb: any) =>
        finishThkMm == null ? eb('finish_thk_mm', 'is', null) : eb('finish_thk_mm', '=', finishThkMm),
      )
      .where((eb: any) => (lengthMm == null ? eb('length_mm', 'is', null) : eb('length_mm', '=', lengthMm)))
      .where((eb: any) =>
        customerId == null ? eb('customer_id', 'is', null) : eb('customer_id', '=', Number(customerId)),
      )
      .executeTakeFirst();

    if (existing) {
      throw new Error(
        'A spec with this exact Grade/Material/Finish/Width/Thickness/Length/Customer already exists. Create a new VERSION of that spec instead.',
      );
    }

    const sheet = await k
      .insertInto('master.spec_sheet')
      .values({
        grade_code: gradeCode,
        material_code: materialCode,
        surface_finish: surfaceFinish != null ? String(surfaceFinish) : null,
        width_mm: widthMm,
        finish_thk_mm: finishThkMm,
        length_mm: lengthMm,
        customer_id: customerId != null ? Number(customerId) : null,
        title: body.title != null ? String(body.title) : `${gradeCode} spec`,
        end_product: body.endProduct != null ? String(body.endProduct) : null,
        isi_mark: body.isiMark != null ? String(body.isiMark) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const version = await k
      .insertInto('master.spec_sheet_version')
      .values({
        spec_sheet_id: sheet.spec_sheet_id,
        version_no: 1,
        status: 'DRAFT',
        created_by: userId,
        notes: body.notes != null ? String(body.notes) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (Array.isArray(body.values) && body.values.length) {
      await this.updateDraftValues(Number(version.version_id), body.values);
    }

    return { sheet, version };
  }

  static async listVersions(specSheetId: number) {
    return k
      .selectFrom('master.spec_sheet_version')
      .selectAll()
      .where('spec_sheet_id', '=', specSheetId)
      .orderBy('version_no', 'desc')
      .execute();
  }

  static async createDraftVersion(
    specSheetId: number,
    body: { notes?: string; copyFromVersionId?: number; values?: unknown[] },
    userId: string,
  ) {
    const existing = await k
      .selectFrom('master.spec_sheet_version')
      .select('version_no')
      .where('spec_sheet_id', '=', specSheetId)
      .execute();
    const nextNo = (existing.reduce((m: number, r: { version_no: number }) => Math.max(m, Number(r.version_no)), 0) || 0) + 1;
    const version = await k
      .insertInto('master.spec_sheet_version')
      .values({
        spec_sheet_id: specSheetId,
        version_no: nextNo,
        status: 'DRAFT',
        created_by: userId,
        notes: body.notes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const copyFrom = body.copyFromVersionId;
    if (copyFrom) {
      const prev = await k
        .selectFrom('master.spec_value')
        .selectAll()
        .where('version_id', '=', copyFrom)
        .execute();
      for (const row of prev) {
        await k
          .insertInto('master.spec_value')
          .values({ ...row, version_id: version.version_id })
          .execute();
      }
    } else if (Array.isArray(body.values)) {
      await this.updateDraftValues(Number(version.version_id), body.values as Array<Record<string, unknown>>);
    }
    return version;
  }

  static async updateDraftValues(
    versionId: number,
    values: Array<Record<string, unknown>>,
  ) {
    const ver = await k
      .selectFrom('master.spec_sheet_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    if (!ver) throw new Error('Version not found');
    if (ver.status !== 'DRAFT') throw new Error('Only DRAFT versions are editable');

    for (const v of values) {
      const code = String(v.parameterCode ?? v.parameter_code ?? '');
      if (!code) continue;
      const row = {
        version_id: versionId,
        parameter_code: code,
        min_value: v.minValue ?? v.min_value ?? null,
        max_value: v.maxValue ?? v.max_value ?? null,
        target_value: v.targetValue ?? v.target_value ?? null,
        tolerance: v.tolerance ?? null,
        text_value: v.textValue ?? v.text_value ?? null,
        is_mandatory: Boolean(v.isMandatory ?? v.is_mandatory ?? false),
      };
      await k
        .insertInto('master.spec_value')
        .values(row)
        .onConflict((oc: any) =>
          oc.columns(['version_id', 'parameter_code']).doUpdateSet({
            min_value: row.min_value,
            max_value: row.max_value,
            target_value: row.target_value,
            tolerance: row.tolerance,
            text_value: row.text_value,
            is_mandatory: row.is_mandatory,
          }),
        )
        .execute();
    }
    return k.selectFrom('master.spec_value').selectAll().where('version_id', '=', versionId).execute();
  }

  static async publishVersion(versionId: number, userId: string) {
    const ver = await k
      .selectFrom('master.spec_sheet_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    if (!ver) throw new Error('Version not found');
    if (ver.status !== 'DRAFT') throw new Error('Only DRAFT versions can be published');

    const now = new Date();
    await k
      .updateTable('master.spec_sheet_version')
      .set({ status: 'SUPERSEDED', effective_to: now })
      .where('spec_sheet_id', '=', ver.spec_sheet_id)
      .where('status', '=', 'ACTIVE')
      .execute();

    await k
      .updateTable('master.spec_sheet_version')
      .set({
        status: 'ACTIVE',
        effective_from: now,
        approved_by: userId,
        approved_at: now,
      })
      .where('version_id', '=', versionId)
      .execute();

    return k
      .selectFrom('master.spec_sheet_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst();
  }

  static async getSpecDetail(specSheetId: number) {
    const sheet = await k
      .selectFrom('master.spec_sheet as s')
      .leftJoin('master.customer as c', 'c.customer_id', 's.customer_id')
      .select([
        's.spec_sheet_id',
        's.grade_code',
        's.material_code',
        's.surface_finish',
        's.width_mm',
        's.finish_thk_mm',
        's.length_mm',
        's.customer_id',
        'c.customer_name',
        's.title',
        's.end_product',
        's.isi_mark',
        's.is_active',
      ])
      .where('s.spec_sheet_id', '=', specSheetId)
      .executeTakeFirst();
    if (!sheet) return null;
    const versions = await this.listVersions(specSheetId);
    return { sheet, versions };
  }

  static async getVersionDetail(versionId: number) {
    const version = await k
      .selectFrom('master.spec_sheet_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    if (!version) return null;
    const values = await k
      .selectFrom('master.spec_value as v')
      .innerJoin('master.spec_parameter as p', 'p.parameter_code', 'v.parameter_code')
      .select([
        'v.parameter_code',
        'p.label',
        'p.unit',
        'p.limit_kind',
        'p.param_group',
        'p.data_type',
        'v.min_value',
        'v.max_value',
        'v.target_value',
        'v.tolerance',
        'v.text_value',
        'v.is_mandatory',
      ])
      .where('v.version_id', '=', versionId)
      .orderBy('p.sort_order', 'asc')
      .execute();
    const active = await k
      .selectFrom('master.spec_sheet_version')
      .select('version_id')
      .where('spec_sheet_id', '=', version.spec_sheet_id)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    let activeValues: unknown[] = [];
    if (active && Number(active.version_id) !== versionId) {
      activeValues = await k
        .selectFrom('master.spec_value')
        .selectAll()
        .where('version_id', '=', active.version_id)
        .execute();
    }
    return { version, values, activeVersionId: active ? Number(active.version_id) : null, activeValues };
  }

  static async whereUsed(versionId: number) {
    const orderCountRow = await k
      .selectFrom('planning.plan_order_spec')
      .select((eb: any) => eb.fn.countAll().as('n'))
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    const qcCountRow = await k
      .selectFrom('txn.qc_measurement')
      .select((eb: any) => eb.fn.countAll().as('n'))
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    const orders = await k
      .selectFrom('planning.plan_order_spec')
      .select(['plan_order_id', 'resolved_at', 'resolved_by', 'override_reason'])
      .where('version_id', '=', versionId)
      .orderBy('resolved_at', 'desc')
      .limit(50)
      .execute();
    const qc = await k
      .selectFrom('txn.qc_measurement')
      .select(['qc_id', 'coil_no', 'process_code', 'parameter_code', 'verdict', 'measured_at'])
      .where('version_id', '=', versionId)
      .orderBy('measured_at', 'desc')
      .limit(50)
      .execute();
    return {
      orderCount: Number(orderCountRow?.n ?? 0),
      qcCount: Number(qcCountRow?.n ?? 0),
      orders,
      qc,
    };
  }

  /** Resolve ACTIVE spec for a plan_order and snapshot it (skip if already manually overridden). */
  static async attachResolvedSpec(
    planOrderId: number | string,
    resolvedBy = 'SYSTEM',
    opts?: { force?: boolean; trx?: unknown },
  ) {
    const conn = (opts?.trx as typeof k) ?? k;
    const existing = await conn
      .selectFrom('planning.plan_order_spec')
      .selectAll()
      .where('plan_order_id', '=', String(planOrderId))
      .executeTakeFirst();
    if (existing?.override_reason && !opts?.force) return existing;

    const order = await conn
      .selectFrom('planning.plan_order')
      .selectAll()
      .where('plan_order_id', '=', String(planOrderId))
      .executeTakeFirst();
    if (!order?.grade_code) return null;

    const resolved = await SpecResolverService.resolve({
      gradeCode: String(order.grade_code),
      customerId: order.customer_id != null ? Number(order.customer_id) : null,
      surfaceFinish: order.surface_finish ?? null,
      widthMm: order.target_width_mm != null ? Number(order.target_width_mm) : null,
      finishThkMm: order.target_thk_mm != null ? Number(order.target_thk_mm) : null,
    });
    if (!resolved) return null;

    if (existing) {
      return conn
        .updateTable('planning.plan_order_spec')
        .set({
          version_id: resolved.versionId,
          resolved_at: new Date(),
          resolved_by: resolvedBy,
          override_reason: null,
        })
        .where('plan_order_id', '=', String(planOrderId))
        .returningAll()
        .executeTakeFirst();
    }
    return conn
      .insertInto('planning.plan_order_spec')
      .values({
        plan_order_id: String(planOrderId),
        version_id: resolved.versionId,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
      })
      .returningAll()
      .executeTakeFirst();
  }

  /** Ensure plan_order + plan_order_spec for a PPC row (fail-soft). */
  static async attachFromPpc(input: {
    sapOrderNo?: string | null;
    coilNo: string;
    gradeCode: string;
    customerName?: string | null;
    widthMm?: number | null;
    finishThkMm?: number | null;
    surfaceFinish?: string | null;
    resolvedBy?: string;
    trx?: unknown;
  }) {
    try {
      const conn = (input.trx as typeof k) ?? k;
      const sap =
        String(input.sapOrderNo ?? '').trim() ||
        `PPC-${input.coilNo}-${input.gradeCode}`.slice(0, 64);

      let customerId: number | null = null;
      if (input.customerName?.trim()) {
        const cust = await conn
          .selectFrom('master.customer')
          .select('customer_id')
          .where('customer_name', '=', input.customerName.trim())
          .executeTakeFirst();
        if (cust) customerId = Number(cust.customer_id);
      }

      let order = await conn
        .selectFrom('planning.plan_order')
        .select('plan_order_id')
        .where('sap_order_no', '=', sap)
        .executeTakeFirst();

      if (!order) {
        order = await conn
          .insertInto('planning.plan_order')
          .values({
            sap_order_no: sap,
            customer_id: customerId,
            grade_code: input.gradeCode,
            surface_finish: input.surfaceFinish ?? null,
            target_width_mm: input.widthMm ?? null,
            target_thk_mm: input.finishThkMm ?? null,
          })
          .returning('plan_order_id')
          .executeTakeFirstOrThrow();
      } else {
        await conn
          .updateTable('planning.plan_order')
          .set({
            customer_id: customerId,
            grade_code: input.gradeCode,
            surface_finish: input.surfaceFinish ?? null,
            target_width_mm: input.widthMm ?? null,
            target_thk_mm: input.finishThkMm ?? null,
          })
          .where('plan_order_id', '=', order.plan_order_id)
          .execute();
      }

      // Link coil_plan lightly so resolveForCoil can find the snapshot
      const existingCp = await conn
        .selectFrom('planning.coil_plan')
        .select('coil_plan_id')
        .where('coil_no', '=', input.coilNo)
        .where('plan_order_id', '=', order.plan_order_id)
        .executeTakeFirst();
      if (!existingCp) {
        // planned_process_id may be required — skip coil_plan if we can't satisfy FK
        try {
          const proc = await conn
            .selectFrom('master.process')
            .select('process_id')
            .where('code', '=', 'CRM')
            .executeTakeFirst();
          if (proc) {
            await conn
              .insertInto('planning.coil_plan')
              .values({
                plan_order_id: order.plan_order_id,
                coil_no: input.coilNo,
                planned_process_id: proc.process_id,
              })
              .execute();
          }
        } catch {
          /* ponytail: coil_plan link optional for snapshot attach */
        }
      }

      return await this.attachResolvedSpec(order.plan_order_id, input.resolvedBy ?? 'SYSTEM', {
        trx: input.trx,
      });
    } catch (err) {
      console.error('[QualitySpecService.attachFromPpc] failed safely:', err);
      return null;
    }
  }

  /** Quality manually pins a specific version onto an order. */
  static async repinOrderSpec(
    planOrderId: number | string,
    versionId: number,
    overrideReason: string,
    resolvedBy: string,
  ) {
    if (!overrideReason?.trim()) throw new Error('overrideReason is required to re-pin');
    const ver = await k
      .selectFrom('master.spec_sheet_version')
      .select('version_id')
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    if (!ver) throw new Error('Version not found');

    const existing = await k
      .selectFrom('planning.plan_order_spec')
      .select('plan_order_id')
      .where('plan_order_id', '=', String(planOrderId))
      .executeTakeFirst();

    if (existing) {
      return k
        .updateTable('planning.plan_order_spec')
        .set({
          version_id: versionId,
          resolved_at: new Date(),
          resolved_by: resolvedBy,
          override_reason: overrideReason.trim(),
        })
        .where('plan_order_id', '=', String(planOrderId))
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return k
      .insertInto('planning.plan_order_spec')
      .values({
        plan_order_id: String(planOrderId),
        version_id: versionId,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        override_reason: overrideReason.trim(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  static async saveQcMeasurement(body: Record<string, unknown>) {
    const row = await k
      .insertInto('txn.qc_measurement')
      .values({
        coil_no: String(body.coilNo ?? body.coil_no),
        process_code: String(body.processCode ?? body.process_code),
        parameter_code: String(body.parameterCode ?? body.parameter_code),
        measured_value_num:
          body.measuredValueNum != null
            ? Number(body.measuredValueNum)
            : typeof body.measuredValue === 'number'
              ? body.measuredValue
              : null,
        measured_value_text:
          body.measuredValueText != null
            ? String(body.measuredValueText)
            : typeof body.measuredValue === 'string'
              ? body.measuredValue
              : null,
        version_id: body.versionId != null ? Number(body.versionId) : null,
        verdict: String(body.verdict ?? 'NOT_EVALUATED'),
        shift_log_id: body.shiftLogId != null ? String(body.shiftLogId) : null,
        entry_id: body.entryId != null ? String(body.entryId) : null,
        measured_by: body.measuredBy != null ? String(body.measuredBy) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row;
  }

  static async listQcMeasurements(filter: {
    coilNo?: string;
    processCode?: string;
    verdict?: string;
    limit?: number;
  }) {
    let q = k
      .selectFrom('txn.qc_measurement as q')
      .leftJoin('master.spec_parameter as p', 'p.parameter_code', 'q.parameter_code')
      .select([
        'q.qc_id',
        'q.coil_no',
        'q.process_code',
        'q.parameter_code',
        'p.label',
        'q.measured_value_num',
        'q.measured_value_text',
        'q.version_id',
        'q.verdict',
        'q.measured_by',
        'q.measured_at',
      ])
      .orderBy('q.measured_at', 'desc')
      .limit(Math.min(filter.limit ?? 100, 500));
    if (filter.coilNo) q = q.where('q.coil_no', '=', filter.coilNo);
    if (filter.processCode) q = q.where('q.process_code', '=', filter.processCode);
    if (filter.verdict) q = q.where('q.verdict', '=', filter.verdict);
    return q.execute();
  }

  /** Tier-3 soft retire of a catalog parameter. */
  static async retireParameter(code: string) {
    const usedVersions = await k
      .selectFrom('master.spec_value as v')
      .innerJoin('master.spec_sheet_version as ver', 'ver.version_id', 'v.version_id')
      .select((eb: any) => eb.fn.countAll().as('n'))
      .where('v.parameter_code', '=', code)
      .where('ver.status', '=', 'ACTIVE')
      .executeTakeFirst();
    const usedQc = await k
      .selectFrom('txn.qc_measurement')
      .select((eb: any) => eb.fn.countAll().as('n'))
      .where('parameter_code', '=', code)
      .executeTakeFirst();
    await k
      .updateTable('master.spec_parameter')
      .set({ is_active: false })
      .where('parameter_code', '=', code)
      .execute();
    return {
      parameterCode: code,
      retired: true,
      activeVersionCount: Number(usedVersions?.n ?? 0),
      qcCount: Number(usedQc?.n ?? 0),
    };
  }

  /** Tier-3 soft retire of a spec sheet. */
  static async retireSpec(specSheetId: number) {
    const orders = await k
      .selectFrom('planning.plan_order_spec as pos')
      .innerJoin('master.spec_sheet_version as v', 'v.version_id', 'pos.version_id')
      .select((eb: any) => eb.fn.countAll().as('n'))
      .where('v.spec_sheet_id', '=', specSheetId)
      .executeTakeFirst();
    await k
      .updateTable('master.spec_sheet')
      .set({ is_active: false })
      .where('spec_sheet_id', '=', specSheetId)
      .execute();
    await k
      .updateTable('master.spec_sheet_version')
      .set({ status: 'SUPERSEDED', effective_to: new Date() })
      .where('spec_sheet_id', '=', specSheetId)
      .where('status', '=', 'ACTIVE')
      .execute();
    return { specSheetId, retired: true, orderCount: Number(orders?.n ?? 0) };
  }

  static async parameterBlastRadius(code: string) {
    const versions = await k
      .selectFrom('master.spec_value as v')
      .innerJoin('master.spec_sheet_version as ver', 'ver.version_id', 'v.version_id')
      .innerJoin('master.spec_sheet as s', 's.spec_sheet_id', 'ver.spec_sheet_id')
      .select(['ver.version_id', 'ver.version_no', 'ver.status', 's.grade_code', 's.spec_sheet_id'])
      .where('v.parameter_code', '=', code)
      .orderBy('ver.version_id', 'desc')
      .limit(50)
      .execute();
    const qc = await k
      .selectFrom('txn.qc_measurement')
      .select(['qc_id', 'coil_no', 'verdict', 'measured_at'])
      .where('parameter_code', '=', code)
      .orderBy('measured_at', 'desc')
      .limit(50)
      .execute();
    return {
      versionCount: versions.length,
      qcCount: qc.length,
      versions,
      qc,
    };
  }
}
