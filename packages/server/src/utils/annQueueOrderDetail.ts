/** Human labels for ANN plan / recipe keys (ppc_batch.raw_row_json + rawExtras). */
const ANN_DETAIL_LABELS: Record<string, string> = {
  batchNumber: 'Batch number',
  planDate: 'Plan date',
  shiftCode: 'Shift',
  coilNo: 'Mother coil',
  slitId: 'Slit ID',
  customerName: 'Customer',
  gradeCode: 'Grade',
  rmGrade: 'RM grade',
  widthMm: 'Height (width mm)',
  slitCombination: 'Slit combination',
  inputThkMm: 'Pre-stage thickness (mm)',
  finishThkMm: 'Finish thickness (mm)',
  ppcWeightMt: 'Coil weight (MT)',
  coilCount: 'Count',
  processRouteRaw: 'Process route',
  processRouteCanonical: 'Route (canonical)',
  fromWorkCenter: 'From work center',
  toWorkCenter: 'To work center',
  sapOrderNo: 'Sale order',
  itemNo: 'Item no',
  ppcRemarks: 'PPC remarks',
  importRemark: 'Import remark',
  chargeNo: 'Charge no (plan)',
  annealingBatch: 'Annealing batch',
  annCycle: 'ANN cycle',
  annCycleNo1: 'ANN cycle no.1',
  annCycleNo2: 'ANN cycle no.2',
  annCycleNo3: 'ANN cycle no.3',
  annCycleNo4: 'ANN cycle no.4',
  firstAnnealingTemp: '1st annealing temp (°C)',
  secondAnnealingTemp: '2nd annealing temp (°C)',
  thirdAnnealingTemp: '3rd annealing temp (°C)',
  fourthAnnealingTemp: '4th annealing temp (°C)',
  firstSoakTime: '1st soak time',
  secondSoakTime: '2nd soak time',
  thirdSoakTime: '3rd soak time',
  fourthSoakTime: '4th soak time',
  heatRate1: 'Heat rate 1',
  heatRate2: 'Heat rate 2',
  heatRate3: 'Heat rate 3',
  heatRate4: 'Heat rate 4',
  rapidCool: 'Rapid cool',
  waterCool: 'Water cool',
  chargeUnload: 'Charge unload',
  firstAnnNo: 'First ANN no.',
  pvDesc: 'PV desc',
  materialCode: 'Material code',
  materialType: 'Material type',
  materialCodeType: 'Material code/type',
  prodVersion: 'Prod. version',
};

const ANN_RECIPE_KEYS = new Set([
  'annCycle', 'annCycleNo1', 'annCycleNo2', 'annCycleNo3', 'annCycleNo4',
  'firstAnnealingTemp', 'secondAnnealingTemp', 'thirdAnnealingTemp', 'fourthAnnealingTemp',
  'firstSoakTime', 'secondSoakTime', 'thirdSoakTime', 'fourthSoakTime',
  'heatRate1', 'heatRate2', 'heatRate3', 'heatRate4',
  'rapidCool', 'waterCool', 'chargeUnload', 'firstAnnNo', 'annealingBatch', 'chargeNo',
]);

const ORDER_KEYS = new Set([
  'batchNumber', 'coilNo', 'slitId', 'customerName', 'gradeCode', 'rmGrade',
  'widthMm', 'slitCombination', 'inputThkMm', 'finishThkMm', 'ppcWeightMt', 'coilCount',
  'processRouteRaw', 'processRouteCanonical', 'fromWorkCenter', 'toWorkCenter',
]);

const PLAN_KEYS = new Set([
  'planDate', 'shiftCode', 'sapOrderNo', 'itemNo', 'ppcRemarks', 'importRemark',
  'pvDesc', 'materialCode', 'materialType', 'materialCodeType', 'prodVersion',
]);

export type AnnDetailField = { label: string; value: string; mono?: boolean };
export type AnnDetailSection = { id: string; title: string; fields: AnnDetailField[] };

function parseRawRowJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function fmtVal(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v).trim();
  return s;
}

function labelForKey(key: string): string {
  if (ANN_DETAIL_LABELS[key]) return ANN_DETAIL_LABELS[key];
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function sectionForKey(key: string): 'order' | 'plan' | 'annRecipe' | 'extra' {
  if (ANN_RECIPE_KEYS.has(key)) return 'annRecipe';
  if (ORDER_KEYS.has(key)) return 'order';
  if (PLAN_KEYS.has(key)) return 'plan';
  return 'extra';
}

function field(label: string, value: unknown, mono = false): AnnDetailField | null {
  const v = fmtVal(value);
  if (!v) return null;
  return { label, value: v, mono };
}

/** Flatten stored plan row + rawExtras into labeled detail sections. */
export function buildAnnPlanDetailSections(
  batch: Record<string, unknown> | null,
  rawRow: Record<string, unknown> | null,
): AnnDetailSection[] {
  const merged: Record<string, unknown> = { ...(rawRow ?? {}) };
  const extras = rawRow?.rawExtras;
  if (extras && typeof extras === 'object' && !Array.isArray(extras)) {
    Object.assign(merged, extras as Record<string, unknown>);
  }
  delete merged.rawExtras;
  delete merged.rollingPassPlans;
  delete merged.errors;

  if (batch) {
    if (!merged.batchNumber && batch.batch_number) merged.batchNumber = batch.batch_number;
    if (!merged.planDate && batch.plan_date) merged.planDate = batch.plan_date;
    if (!merged.shiftCode && batch.shift_code) merged.shiftCode = batch.shift_code;
    if (!merged.coilNo && batch.coil_no) merged.coilNo = batch.coil_no;
    if (!merged.slitId && batch.slit_id) merged.slitId = batch.slit_id;
    if (!merged.customerName && batch.customer_name) merged.customerName = batch.customer_name;
    if (!merged.gradeCode && batch.grade_code) merged.gradeCode = batch.grade_code;
    if (!merged.widthMm && batch.width_mm != null) merged.widthMm = batch.width_mm;
    if (!merged.inputThkMm && batch.input_thk_mm != null) merged.inputThkMm = batch.input_thk_mm;
    if (!merged.finishThkMm && batch.finish_thk_mm != null) merged.finishThkMm = batch.finish_thk_mm;
    if (!merged.ppcWeightMt && batch.ppc_weight_mt != null) merged.ppcWeightMt = batch.ppc_weight_mt;
    if (!merged.processRouteRaw && batch.process_route_raw) merged.processRouteRaw = batch.process_route_raw;
    if (!merged.fromWorkCenter && batch.from_work_center) merged.fromWorkCenter = batch.from_work_center;
    if (!merged.toWorkCenter && batch.to_work_center) merged.toWorkCenter = batch.to_work_center;
    if (!merged.sapOrderNo && batch.sap_order_no) merged.sapOrderNo = batch.sap_order_no;
    if (!merged.itemNo && batch.item_no) merged.itemNo = batch.item_no;
    if (!merged.ppcRemarks && batch.ppc_remarks) merged.ppcRemarks = batch.ppc_remarks;
    if (!merged.importRemark && batch.import_remark) merged.importRemark = batch.import_remark;
  }

  const buckets: Record<string, AnnDetailField[]> = {
    order: [],
    plan: [],
    annRecipe: [],
    extra: [],
  };
  const seen = new Set<string>();

  for (const [key, val] of Object.entries(merged)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const f = field(labelForKey(key), val, /coil|batch|route|slit|temp|rate|ann|charge|grade|width|thk|mm|mt|no/i.test(key));
    if (!f) continue;
    buckets[sectionForKey(key)].push(f);
  }

  const sections: AnnDetailSection[] = [];
  if (buckets.order.length) sections.push({ id: 'order', title: 'Order', fields: buckets.order });
  if (buckets.plan.length) sections.push({ id: 'plan', title: 'Plan', fields: buckets.plan });
  if (buckets.annRecipe.length) sections.push({ id: 'annRecipe', title: 'ANN cycle & recipe', fields: buckets.annRecipe });
  if (buckets.extra.length) sections.push({ id: 'extra', title: 'Other plan fields', fields: buckets.extra });
  return sections;
}
