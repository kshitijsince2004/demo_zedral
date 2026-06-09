import { db, withTenantContext } from '../db';
import { getTenantId } from '../context';

export interface LineageRef {
  record_id: string;
  tenant_id: string;
  batch_id: string | null;
  source_row_ref: string | null;
  mapping_version: string | null;
  created_at: Date;
}

/**
 * LineageService resolves the lineage for any given canonical record.
 */
export const getLineageForRecord = async (recordId: string): Promise<LineageRef | null> => {
  return await withTenantContext(async (trx) => {
    const row = await trx.selectFrom('audit.lineage_ref' as any)
      .selectAll()
      .where('record_id', '=', recordId)
      // tenant_id filtering is automatically applied by RLS, but we add it for clarity
      .where('tenant_id', '=', getTenantId()!)
      .executeTakeFirst();
    return (row as LineageRef | undefined) ?? null;
  });
};

/**
 * Link a record to its source batch/mapping.
 */
export const recordLineage = async (
  recordId: string, 
  batchId?: string, 
  sourceRowRef?: string, 
  mappingVersion?: string
): Promise<LineageRef> => {
  return await withTenantContext(async (trx) => {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new Error('Tenant context is missing');
    }

    return await trx.insertInto('audit.lineage_ref' as any)
      .values({
        record_id: recordId,
        tenant_id: tenantId,
        batch_id: batchId || null,
        source_row_ref: sourceRowRef || null,
        mapping_version: mappingVersion || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow() as LineageRef;
  });
};
