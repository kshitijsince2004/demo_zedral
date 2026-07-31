/** Soft capacity / clubbing checks for ANN batching (advisory only). */

export type AnnBaseCapacity = {
  base_no: string;
  capacity_max_coils: number | string | null;
  capacity_max_wt_mt: number | string | null;
};

export type AnnSpecLimit = {
  param_key: string;
  scope: string;
  min_val: number | string | null;
  max_val: number | string | null;
  unit: string | null;
};

export function annBatchingAdvisories(input: {
  coilCount: number;
  weightMt: number;
  base: AnnBaseCapacity | null;
  limits: AnnSpecLimit[];
}): string[] {
  const warnings: string[] = [];
  if (input.base) {
    const maxCoils = input.base.capacity_max_coils != null ? Number(input.base.capacity_max_coils) : null;
    const maxWt = input.base.capacity_max_wt_mt != null ? Number(input.base.capacity_max_wt_mt) : null;
    if (maxCoils != null && Number.isFinite(maxCoils) && input.coilCount > maxCoils) {
      warnings.push(`Stack has ${input.coilCount} coils; base ${input.base.base_no} max is ${maxCoils}.`);
    }
    if (maxWt != null && Number.isFinite(maxWt) && input.weightMt > maxWt) {
      warnings.push(`Stack weight ${input.weightMt.toFixed(2)} MT exceeds base ${input.base.base_no} max ${maxWt} MT.`);
    }
  }
  const club = input.limits.find((l) => l.param_key === 'clubbing_soak_spread' && (l.scope === 'ALL' || !l.scope));
  if (club && input.coilCount > 1) {
    const min = club.min_val != null ? Number(club.min_val) : null;
    const max = club.max_val != null ? Number(club.max_val) : null;
    const band =
      min != null && max != null
        ? `${min}–${max}${club.unit ? ` ${club.unit}` : ''}`
        : max != null
          ? `≤ ${max}${club.unit ? ` ${club.unit}` : ''}`
          : null;
    if (band) {
      warnings.push(`Clubbing advisory: keep soak-temp spread within ${band} across stacked coils.`);
    }
  }
  return warnings;
}
