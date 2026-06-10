import { FieldMappingStore } from './fieldMappingStore';
import { DprSourceAdapter } from './DprSourceAdapter';
import { ProductionAdapter, StoppageAdapter, DispositionAdapter, TargetAdapter } from './adapters';

export class IntegrationLayer {
  private adapters: Map<string, DprSourceAdapter> = new Map();

  constructor(private store: FieldMappingStore) {
    const prod = new ProductionAdapter();
    const stop = new StoppageAdapter();
    const disp = new DispositionAdapter();
    const tgt = new TargetAdapter();

    this.adapters.set(prod.name, prod);
    this.adapters.set(stop.name, stop);
    this.adapters.set(disp.name, disp);
    this.adapters.set(tgt.name, tgt);
  }

  async resolveForDay(dayNumber: number): Promise<Record<string, number | null>> {
    const mappings = await this.store.getActiveMappings();
    const results: Record<string, number | null> = {};

    for (const mapping of mappings) {
      const adapter = this.adapters.get(mapping.adapter);
      if (adapter) {
        try {
          results[mapping.fieldId] = await adapter.resolveForDay(dayNumber, mapping.config);
        } catch (e) {
          results[mapping.fieldId] = null;
        }
      } else {
        results[mapping.fieldId] = null;
      }
    }

    return results;
  }

  async applyMappingEdit(fieldId: string, adapter: string, config: any) {
    await this.store.applyMappingEdit(fieldId, adapter, config);
  }
}
