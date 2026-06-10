import { db } from '../../db';
import { sql } from 'kysely';

export async function scanDbSchema() {
  const result = await sql`
    SELECT table_schema, table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema IN ('txn', 'planning', 'master')
  `.execute(db);
  return result.rows;
}

export function enumerateExpressRoutes(app: any): string[] {
  // Stub implementation
  return ['/api/txn/prod', '/api/planning/orders'];
}

export function inspectServiceExports(): string[] {
  // Stub implementation
  return ['StoppageService', 'ProductionService'];
}
