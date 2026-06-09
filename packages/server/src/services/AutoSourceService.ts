import { buildAutoSourceFields, PrefilledField } from './autoSourceFieldMaps';
import { loadAutoSourceContext } from './autoSourceContext';

export type { PrefilledField };

export class AutoSourceService {
  /**
   * Resolves pre-filled capture fields for a process/coil pair.
   * Hierarchy: planning.coil_plan → plan_order → coil.coil → grade_spec → coil_process_history.
   */
  static async getPrefilledFields(
    processCode: string,
    coilNumber: string,
  ): Promise<Record<string, PrefilledField>> {
    const ctx = await loadAutoSourceContext(processCode, coilNumber);
    return buildAutoSourceFields(ctx);
  }
}
