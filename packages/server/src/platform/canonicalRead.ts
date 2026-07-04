import { db } from '../db';

export async function findEquipmentAssetIdByProcessCode(processCode: string): Promise<string | null> {
  const row = await db
    .selectFrom('canon.equipment_node')
    .select('asset_id')
    .where('process_code', '=', processCode)
    .executeTakeFirst();

  return row?.asset_id ?? null;
}

export async function findFirstEquipmentAssetId(): Promise<string | null> {
  const row = await db
    .selectFrom('canon.equipment_node')
    .select('asset_id')
    .orderBy('created_at', 'asc')
    .executeTakeFirst();

  return row?.asset_id ?? null;
}
