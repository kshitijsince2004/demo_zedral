import { SourceMapEntry, FieldSourceOption } from './sourceMapTypes';
import { DprSourceMapRepository } from '../repositories/DprSourceMapRepository';
import { scanDbSchema } from './codebaseInventory';

export class SourceMapService {
  constructor(private repo: DprSourceMapRepository) {}

  async discover(fields: string[]): Promise<SourceMapEntry[]> {
    const dbSchema = await scanDbSchema();
    const entries: SourceMapEntry[] = [];

    for (const field of fields) {
      let status: 'auto-sourced' | 'needs-confirmation' | 'manual' = 'manual';
      
      if (field.includes('Production')) {
        status = 'needs-confirmation';
      } else if (field.includes('Stoppage')) {
        status = 'auto-sourced';
      }

      const entry: SourceMapEntry = {
        fieldId: field,
        status,
        options: []
      };

      await this.repo.upsert(field, status, { options: entry.options });
      entries.push(entry);
    }
    return entries;
  }

  async rediscover(extraLocations: string[]) {
    // Stub implementation
    return [];
  }

  async answerQuestion(fieldId: string, answer: FieldSourceOption, machineId?: string, unit?: string, grain?: string) {
    const resolutionData = {
      selectedOption: answer,
      machineIdentifier: machineId,
      unit,
      grain
    };
    await this.repo.upsert(fieldId, 'confirmed', resolutionData);
  }
}
