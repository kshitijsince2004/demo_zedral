import { AutoSourceContext } from './autoSourceContext';

export interface PrefilledField {
  value: unknown;
  source: 'PLANNING' | 'COIL_MASTER' | 'GRADE_SPEC' | 'PREVIOUS_PROCESS' | 'MANUAL';
  isEditable: boolean;
}

export function resolveField(
  planningVal: unknown,
  coilMasterVal: unknown,
  gradeSpecVal: unknown,
  previousProcessVal: unknown,
  isEditable: boolean,
): PrefilledField {
  if (planningVal !== undefined && planningVal !== null) {
    return { value: planningVal, source: 'PLANNING', isEditable };
  }
  if (coilMasterVal !== undefined && coilMasterVal !== null) {
    return { value: coilMasterVal, source: 'COIL_MASTER', isEditable };
  }
  if (gradeSpecVal !== undefined && gradeSpecVal !== null) {
    return { value: gradeSpecVal, source: 'GRADE_SPEC', isEditable };
  }
  if (previousProcessVal !== undefined && previousProcessVal !== null) {
    return { value: previousProcessVal, source: 'PREVIOUS_PROCESS', isEditable };
  }
  return { value: null, source: 'MANUAL', isEditable: true };
}

function setIfSourced(
  fields: Record<string, PrefilledField>,
  name: string,
  field: PrefilledField,
): void {
  if (field.source !== 'MANUAL' && field.value !== null && field.value !== undefined) {
    fields[name] = field;
  }
}

function hardnessMidpoint(ctx: AutoSourceContext): number | null {
  const min = ctx.gradeSpec?.hardnessHrbMin;
  const max = ctx.gradeSpec?.hardnessHrbMax;
  if (min === null || min === undefined || max === null || max === undefined) return null;
  return Math.round(((min + max) / 2) * 100) / 100;
}

function plannedWidth(ctx: AutoSourceContext): number | null {
  return ctx.plan?.targetWidthMm ?? null;
}

function plannedThk(ctx: AutoSourceContext): number | null {
  return ctx.plan?.targetThkMm ?? null;
}

function coilWidth(ctx: AutoSourceContext): number | null {
  return ctx.coil?.coilWidthMm ?? ctx.coil?.nominalWidthMm ?? null;
}

function coilThk(ctx: AutoSourceContext): number | null {
  return ctx.coil?.coilThkMm ?? null;
}

function coilWeight(ctx: AutoSourceContext): number | null {
  return ctx.coil?.weightMt ?? null;
}

function previousOutThk(ctx: AutoSourceContext): number | null {
  return ctx.previousProcess?.outThkMm ?? null;
}

function previousOutWeight(ctx: AutoSourceContext): number | null {
  return ctx.previousProcess?.outWeightMt ?? null;
}

export function buildAutoSourceFields(ctx: AutoSourceContext): Record<string, PrefilledField> {
  const fields: Record<string, PrefilledField> = {};

  switch (ctx.processCode) {
    case 'HRS':
      setIfSourced(
        fields,
        'nominalWidthMm',
        resolveField(plannedWidth(ctx), ctx.coil?.nominalWidthMm, null, null, true),
      );
      setIfSourced(
        fields,
        'nominalThkMm',
        resolveField(plannedThk(ctx), coilThk(ctx), null, null, true),
      );
      setIfSourced(
        fields,
        'weightMt',
        resolveField(ctx.plan?.plannedQtyMt, coilWeight(ctx), null, null, true),
      );
      break;

    case 'PKL':
      setIfSourced(
        fields,
        'widthMm',
        resolveField(plannedWidth(ctx), coilWidth(ctx), null, null, false),
      );
      setIfSourced(
        fields,
        'thkMm',
        resolveField(null, coilThk(ctx), null, previousOutThk(ctx), false),
      );
      setIfSourced(
        fields,
        'weightMt',
        resolveField(null, coilWeight(ctx), null, previousOutWeight(ctx), true),
      );
      if (ctx.coil?.heatNo) {
        fields.heatNo = {
          value: ctx.coil.heatNo,
          source: 'COIL_MASTER',
          isEditable: false,
        };
      }
      if (ctx.plan?.sapOrderNo) {
        fields.source = {
          value: ctx.plan.sapOrderNo,
          source: 'PLANNING',
          isEditable: false,
        };
      }
      break;

    case 'CRM':
      setIfSourced(
        fields,
        'widthMm',
        resolveField(plannedWidth(ctx), coilWidth(ctx), null, null, false),
      );
      setIfSourced(
        fields,
        'inputThkMm',
        resolveField(null, coilThk(ctx), null, previousOutThk(ctx), false),
      );
      setIfSourced(
        fields,
        'outputThkMm',
        resolveField(plannedThk(ctx), null, null, null, true),
      );
      setIfSourced(
        fields,
        'weightMt',
        resolveField(null, coilWeight(ctx), null, previousOutWeight(ctx), true),
      );
      setIfSourced(
        fields,
        'hardnessHrb',
        resolveField(null, null, hardnessMidpoint(ctx), null, true),
      );
      break;

    case 'CRS':
      setIfSourced(
        fields,
        'coilWidthMm',
        resolveField(plannedWidth(ctx), coilWidth(ctx), null, null, true),
      );
      setIfSourced(
        fields,
        'nominalThkMm',
        resolveField(plannedThk(ctx), coilThk(ctx), null, previousOutThk(ctx), true),
      );
      setIfSourced(
        fields,
        'outputWtMt',
        resolveField(null, coilWeight(ctx), null, previousOutWeight(ctx), true),
      );
      setIfSourced(
        fields,
        'hardnessHrb',
        resolveField(null, null, hardnessMidpoint(ctx), null, true),
      );
      setIfSourced(
        fields,
        'raUm',
        resolveField(null, null, ctx.gradeSpec?.raUmMax ?? null, null, true),
      );
      break;

    default:
      break;
  }

  return fields;
}
