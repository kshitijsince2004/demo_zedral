import type { MachineSpecView } from '../services/MachineSpecService';

export type EligibilityOrder = {
  requiredMandrelIdMm?: number | null;
  widthMm?: number | null;
  thicknessMm?: number | null;
  coilWeightMt?: number | null;
  exitOdMm?: number | null;
  suggestedMachine?: string | null;
};

export type EligibilityResult = {
  eligible: boolean;
  hardBlocked: boolean;
  warnings: string[];
  overrideRequired: boolean;
  suggestedMachine: string | null;
};

/** Hard gate = mandrel ID; soft = width/thk/weight/OD (warn + override). Missing envelope ⇒ no constraint. */
export function isEligible(order: EligibilityOrder, spec: MachineSpecView | null): EligibilityResult {
  const warnings: string[] = [];
  let hardBlocked = false;

  if (!spec) {
    return {
      eligible: true,
      hardBlocked: false,
      warnings: [],
      overrideRequired: false,
      suggestedMachine: order.suggestedMachine ?? null,
    };
  }

  const id = order.requiredMandrelIdMm;
  if (id != null && spec.mandrelIds.length > 0 && !spec.mandrelIds.includes(Number(id))) {
    hardBlocked = true;
    warnings.push(`Mandrel ID ${id} not in machine set [${spec.mandrelIds.join(',')}]`);
  }

  if (order.widthMm != null) {
    if (spec.widthMinMm != null && order.widthMm < spec.widthMinMm) {
      warnings.push(`Width ${order.widthMm} < min ${spec.widthMinMm}`);
    }
    if (spec.widthMaxMm != null && order.widthMm > spec.widthMaxMm) {
      warnings.push(`Width ${order.widthMm} > max ${spec.widthMaxMm}`);
    }
  }

  if (order.thicknessMm != null) {
    if (spec.thkMinMm != null && order.thicknessMm < spec.thkMinMm) {
      warnings.push(`Thickness ${order.thicknessMm} < min ${spec.thkMinMm}`);
    }
    if (spec.thkMaxMm != null && order.thicknessMm > spec.thkMaxMm) {
      warnings.push(`Thickness ${order.thicknessMm} > max ${spec.thkMaxMm}`);
    }
  }

  if (order.coilWeightMt != null) {
    if (spec.coilWtMinMt != null && order.coilWeightMt < spec.coilWtMinMt) {
      warnings.push(`Coil wt ${order.coilWeightMt} < min ${spec.coilWtMinMt}`);
    }
    if (spec.coilWtMaxMt != null && order.coilWeightMt > spec.coilWtMaxMt) {
      warnings.push(`Coil wt ${order.coilWeightMt} > max ${spec.coilWtMaxMt}`);
    }
  }

  if (order.exitOdMm != null && spec.exitOdMaxMm != null && order.exitOdMm > spec.exitOdMaxMm) {
    warnings.push(`Exit OD ${order.exitOdMm} > max ${spec.exitOdMaxMm}`);
  }

  const softOnly = warnings.filter((w) => !w.startsWith('Mandrel'));
  return {
    eligible: !hardBlocked,
    hardBlocked,
    warnings,
    overrideRequired: softOnly.length > 0 && !hardBlocked,
    suggestedMachine: order.suggestedMachine ?? spec.machineCode,
  };
}
