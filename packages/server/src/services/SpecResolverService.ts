import { db } from '../db';
import { logger } from '../utils/logger';

// ponytail: tables land in migration before kysely regen — cast until db-types catches up
const k = db as any;

export type SpecLimitKind = 'MIN_MAX' | 'MAX_ONLY' | 'MIN_ONLY' | 'TARGET_TOL' | 'EXACT';
export type SpecVerdict = 'PASS' | 'FAIL' | 'NOT_EVALUATED';
export type SpecSource = 'customer' | 'default';

export interface ResolveKey {
  gradeCode: string;
  materialCode?: string | null;
  surfaceFinish?: string | null;
  widthMm?: number | null;
  finishThkMm?: number | null;
  lengthMm?: number | null;
  customerId?: number | null;
  atTime?: Date;
}

export interface ResolvedParameter {
  code: string;
  label: string;
  group: string | null;
  unit: string | null;
  dataType: string;
  limitKind: SpecLimitKind;
  min: number | null;
  max: number | null;
  target: number | null;
  tolerance: number | null;
  textValue: string | null;
  mandatory: boolean;
  appliesTo: string[];
}

export interface ResolvedSpec {
  versionId: number;
  specSheetId: number;
  versionNo: number;
  source: SpecSource;
  parameters: ResolvedParameter[];
}

/** Pure limit evaluation — unit-testable without DB. */
export function evaluateLimit(
  limitKind: SpecLimitKind,
  limits: {
    min?: number | null;
    max?: number | null;
    target?: number | null;
    tolerance?: number | null;
    textValue?: string | null;
  },
  measured: number | string | null | undefined,
): SpecVerdict {
  if (measured == null || measured === '') return 'NOT_EVALUATED';

  if (limitKind === 'EXACT') {
    if (typeof measured === 'string' || limits.textValue != null) {
      if (limits.textValue == null) return 'NOT_EVALUATED';
      return String(measured).trim().toUpperCase() === String(limits.textValue).trim().toUpperCase()
        ? 'PASS'
        : 'FAIL';
    }
    if (limits.target == null) return 'NOT_EVALUATED';
    return Number(measured) === Number(limits.target) ? 'PASS' : 'FAIL';
  }

  const n = typeof measured === 'number' ? measured : Number(measured);
  if (!Number.isFinite(n)) return 'NOT_EVALUATED';

  if (limitKind === 'MIN_MAX') {
    if (limits.min == null && limits.max == null) return 'NOT_EVALUATED';
    if (limits.min != null && n < Number(limits.min)) return 'FAIL';
    if (limits.max != null && n > Number(limits.max)) return 'FAIL';
    return 'PASS';
  }
  if (limitKind === 'MIN_ONLY') {
    if (limits.min == null) return 'NOT_EVALUATED';
    return n >= Number(limits.min) ? 'PASS' : 'FAIL';
  }
  if (limitKind === 'MAX_ONLY') {
    if (limits.max == null) return 'NOT_EVALUATED';
    return n <= Number(limits.max) ? 'PASS' : 'FAIL';
  }
  if (limitKind === 'TARGET_TOL') {
    if (limits.target == null) return 'NOT_EVALUATED';
    const tol = limits.tolerance != null ? Number(limits.tolerance) : 0;
    const t = Number(limits.target);
    return n >= t - tol && n <= t + tol ? 'PASS' : 'FAIL';
  }
  return 'NOT_EVALUATED';
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadVersionParameters(versionId: number): Promise<ResolvedParameter[]> {
  const rows = await k
    .selectFrom('master.spec_value as v')
    .innerJoin('master.spec_parameter as p', 'p.parameter_code', 'v.parameter_code')
    .select([
      'v.parameter_code',
      'p.label',
      'p.param_group',
      'p.unit',
      'p.data_type',
      'p.limit_kind',
      'p.applies_to',
      'v.min_value',
      'v.max_value',
      'v.target_value',
      'v.tolerance',
      'v.text_value',
      'v.is_mandatory',
    ])
    .where('v.version_id', '=', versionId)
    .where('p.is_active', '=', true)
    .orderBy('p.sort_order', 'asc')
    .execute();

  return rows.map((r: any) => ({
      code: r.parameter_code,
      label: r.label,
      group: r.param_group ?? null,
      unit: r.unit ?? null,
      dataType: r.data_type,
      limitKind: r.limit_kind as SpecLimitKind,
      min: numOrNull(r.min_value),
      max: numOrNull(r.max_value),
      target: numOrNull(r.target_value),
      tolerance: numOrNull(r.tolerance),
      textValue: r.text_value ?? null,
      mandatory: Boolean(r.is_mandatory),
      appliesTo: Array.isArray(r.applies_to) ? r.applies_to : [],
  }));
}

async function findSheet(key: ResolveKey, requireCustomer: boolean | 'null') {
  let q = k
    .selectFrom('master.spec_sheet')
    .selectAll()
    .where('is_active', '=', true)
    .where('grade_code', '=', key.gradeCode)
    .where('material_code', '=', key.materialCode ?? '');

  if (key.surfaceFinish) q = q.where('surface_finish', '=', key.surfaceFinish);
  else q = q.where('surface_finish', 'is', null);

  if (key.widthMm != null) q = q.where('width_mm', '=', key.widthMm);
  else q = q.where('width_mm', 'is', null);

  if (key.finishThkMm != null) q = q.where('finish_thk_mm', '=', key.finishThkMm);
  else q = q.where('finish_thk_mm', 'is', null);

  if (key.lengthMm != null) q = q.where('length_mm', '=', key.lengthMm);
  else q = q.where('length_mm', 'is', null);

  if (requireCustomer === true) {
    if (key.customerId == null) return null;
    q = q.where('customer_id', '=', key.customerId);
  } else if (requireCustomer === 'null') {
    q = q.where('customer_id', 'is', null);
  }

  return q.executeTakeFirst();
}

async function activeVersion(specSheetId: number, atTime: Date) {
  return k
    .selectFrom('master.spec_sheet_version')
    .selectAll()
    .where('spec_sheet_id', '=', specSheetId)
    .where('status', '=', 'ACTIVE')
    .where((eb: any) =>
      eb.or([
        eb('effective_from', 'is', null),
        eb('effective_from', '<=', atTime),
      ]),
    )
    .where((eb: any) =>
      eb.or([
        eb('effective_to', 'is', null),
        eb('effective_to', '>', atTime),
      ]),
    )
    .orderBy('version_no', 'desc')
    .executeTakeFirst();
}

export class SpecResolverService {
  /** Resolve live ACTIVE spec. Missing → null (never throws). */
  static async resolve(key: ResolveKey): Promise<ResolvedSpec | null> {
    try {
      if (!key.gradeCode) return null;
      const at = key.atTime ?? new Date();

      let source: SpecSource = 'default';
      let sheet = key.customerId != null ? await findSheet(key, true) : null;
      if (sheet) source = 'customer';
      if (!sheet) sheet = await findSheet(key, 'null');
      // Relax dimensional keys: grade + material + customer/default only
      if (!sheet) {
        sheet = await findSheet(
          { ...key, surfaceFinish: null, widthMm: null, finishThkMm: null, lengthMm: null },
          key.customerId != null ? true : 'null',
        );
        if (sheet && key.customerId != null) source = 'customer';
      }
      if (!sheet && key.customerId != null) {
        sheet = await findSheet(
          { ...key, surfaceFinish: null, widthMm: null, finishThkMm: null, lengthMm: null },
          'null',
        );
        source = 'default';
      }
      if (!sheet) return null;

      const version = await activeVersion(Number(sheet.spec_sheet_id), at);
      if (!version) return null;

      const parameters = await loadVersionParameters(Number(version.version_id));
      return {
        versionId: Number(version.version_id),
        specSheetId: Number(sheet.spec_sheet_id),
        versionNo: Number(version.version_no),
        source,
        parameters,
      };
    } catch (err) {
      logger.error('[SpecResolverService.resolve] failed safely:', err);
      return null;
    }
  }

  static async evaluate(input: {
    versionId: number;
    parameterCode: string;
    measuredValue: number | string | null | undefined;
  }): Promise<SpecVerdict> {
    try {
      const row = await k
        .selectFrom('master.spec_value as v')
        .innerJoin('master.spec_parameter as p', 'p.parameter_code', 'v.parameter_code')
        .select([
          'p.limit_kind',
          'v.min_value',
          'v.max_value',
          'v.target_value',
          'v.tolerance',
          'v.text_value',
        ])
        .where('v.version_id', '=', input.versionId)
        .where('v.parameter_code', '=', input.parameterCode)
        .executeTakeFirst();
      if (!row) return 'NOT_EVALUATED';
      return evaluateLimit(
        row.limit_kind as SpecLimitKind,
        {
          min: numOrNull(row.min_value),
          max: numOrNull(row.max_value),
          target: numOrNull(row.target_value),
          tolerance: numOrNull(row.tolerance),
          textValue: row.text_value,
        },
        input.measuredValue,
      );
    } catch (err) {
      logger.error('[SpecResolverService.evaluate] failed safely:', err);
      return 'NOT_EVALUATED';
    }
  }

  /** Snapshot read for an order — never live-resolves. */
  static async resolveForOrder(planOrderId: number | string): Promise<ResolvedSpec | null> {
    try {
      const snap = await k
        .selectFrom('planning.plan_order_spec as pos')
        .innerJoin('master.spec_sheet_version as v', 'v.version_id', 'pos.version_id')
        .select([
          'pos.version_id',
          'v.spec_sheet_id',
          'v.version_no',
        ])
        .where('pos.plan_order_id', '=', String(planOrderId))
        .executeTakeFirst();
      if (!snap) return null;
      const parameters = await loadVersionParameters(Number(snap.version_id));
      return {
        versionId: Number(snap.version_id),
        specSheetId: Number(snap.spec_sheet_id),
        versionNo: Number(snap.version_no),
        source: 'customer',
        parameters,
      };
    } catch (err) {
      logger.error('[SpecResolverService.resolveForOrder] failed safely:', err);
      return null;
    }
  }

  /** Prefer plan_order snapshot by SAP order no; else null (caller may live-resolve). */
  static async resolveForSapOrder(sapOrderNo: string): Promise<ResolvedSpec | null> {
    try {
      if (!sapOrderNo?.trim()) return null;
      const order = await k
        .selectFrom('planning.plan_order')
        .select('plan_order_id')
        .where('sap_order_no', '=', sapOrderNo.trim())
        .executeTakeFirst();
      if (!order) return null;
      return this.resolveForOrder(order.plan_order_id);
    } catch (err) {
      logger.error('[SpecResolverService.resolveForSapOrder] failed safely:', err);
      return null;
    }
  }

  /** Snapshot (or live fallback key) for a coil via plan_order / ppc sap order. */
  static async resolveForCoil(coilNo: string): Promise<ResolvedSpec | null> {
    try {
      if (!coilNo?.trim()) return null;

      const viaPlan = await k
        .selectFrom('planning.coil_plan as cp')
        .innerJoin('planning.plan_order_spec as pos', 'pos.plan_order_id', 'cp.plan_order_id')
        .select('cp.plan_order_id')
        .where('cp.coil_no', '=', coilNo.trim())
        .orderBy('cp.coil_plan_id', 'desc')
        .executeTakeFirst();
      if (viaPlan) {
        const snap = await this.resolveForOrder(viaPlan.plan_order_id);
        if (snap) return snap;
      }

      const ppc = await k
        .selectFrom('planning.ppc_batch')
        .select(['sap_order_no', 'grade_code', 'customer_name', 'width_mm', 'ppc_thk_mm'])
        .where('coil_no', '=', coilNo.trim())
        .orderBy('batch_id', 'desc')
        .executeTakeFirst();
      if (ppc?.sap_order_no) {
        const snap = await this.resolveForSapOrder(String(ppc.sap_order_no));
        if (snap) return snap;
      }
      if (ppc?.grade_code) {
        let customerId: number | null = null;
        if (ppc.customer_name) {
          const cust = await k
            .selectFrom('master.customer')
            .select('customer_id')
            .where('customer_name', '=', ppc.customer_name)
            .executeTakeFirst();
          customerId = cust ? Number(cust.customer_id) : null;
        }
        return this.resolve({
          gradeCode: String(ppc.grade_code),
          customerId,
          widthMm: ppc.width_mm != null ? Number(ppc.width_mm) : null,
          finishThkMm: ppc.ppc_thk_mm != null ? Number(ppc.ppc_thk_mm) : null,
        });
      }

      const coil = await k
        .selectFrom('coil.coil')
        .select(['grade_code', 'customer_id'])
        .where('coil_no', '=', coilNo.trim())
        .executeTakeFirst();
      if (!coil?.grade_code) return null;
      return this.resolve({
        gradeCode: String(coil.grade_code),
        customerId: coil.customer_id != null ? Number(coil.customer_id) : null,
      });
    } catch (err) {
      logger.error('[SpecResolverService.resolveForCoil] failed safely:', err);
      return null;
    }
  }
}
