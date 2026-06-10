import { db } from '../../db';
import { sql } from 'kysely';

export interface FieldMapping {
  fieldId: string;
  adapter: string;
  config: any;
}

export class FieldMappingStore {
  async getActiveMappings(): Promise<FieldMapping[]> {
    const result = await sql`SELECT field_id as "fieldId", adapter, config FROM dpr.field_mapping`.execute(db);
    return result.rows as FieldMapping[];
  }

  async applyMappingEdit(fieldId: string, adapter: string, config: any): Promise<void> {
    await sql`
      INSERT INTO dpr.field_mapping (field_id, adapter, config) 
      VALUES (${fieldId}, ${adapter}, ${JSON.stringify(config)})
      ON CONFLICT (field_id) DO UPDATE 
      SET adapter = EXCLUDED.adapter, config = EXCLUDED.config, updated_at = NOW()
    `.execute(db);
  }
}
