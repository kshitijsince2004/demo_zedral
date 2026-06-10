import { db } from '../src/db';
import { sql } from 'kysely';

async function run() {
  await sql`CREATE SCHEMA IF NOT EXISTS dpr`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS dpr.template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_file_blob BYTEA,
    blank_master_blob BYTEA NOT NULL,
    geometry_model JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by UUID
  )`.execute(db);

  await sql`CREATE TABLE IF NOT EXISTS dpr.month (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES dpr.template,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    sheet_code TEXT NOT NULL,
    days_in_month INTEGER NOT NULL,
    config_overrides JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`.execute(db);

  await sql`CREATE TABLE IF NOT EXISTS dpr.daily_entry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    month_id UUID NOT NULL REFERENCES dpr.month,
    day_number INTEGER NOT NULL,
    values JSONB NOT NULL DEFAULT '{}',
    delay_data JSONB NOT NULL DEFAULT '[]',
    field_provenance JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'entered',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (month_id, day_number)
  )`.execute(db);

  await sql`CREATE TABLE IF NOT EXISTS dpr.source_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    resolution_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`.execute(db);

  await sql`CREATE TABLE IF NOT EXISTS dpr.field_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id TEXT NOT NULL UNIQUE,
    adapter TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`.execute(db);

  console.log("DPR schema created successfully");
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
