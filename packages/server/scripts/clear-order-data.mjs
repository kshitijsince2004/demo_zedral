#!/usr/bin/env node
/**
 * Removes CRM6/PPC orders, import batches, and planning queue data.
 * Preserves users, master data, shift logs, and non-order production history.
 *
 * Usage: npm run clear:orders -w @m1/server
 */
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

async function count(client, sql) {
  const { rows } = await client.query(sql);
  return Number(rows[0]?.n ?? 0);
}

export async function clearOrderData(databaseUrl = DATABASE_URL) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const summary = {};

  try {
    await client.query('BEGIN');

    // Order-linked operational records (no cascade from ppc_batch)
    summary.orderMachineTransfer = (
      await client.query('DELETE FROM txn.order_machine_transfer RETURNING transfer_id')
    ).rowCount;

    summary.machineHandover = (
      await client.query(
        `DELETE FROM txn.machine_handover
         WHERE order_id IS NOT NULL OR batch_number IS NOT NULL
         RETURNING handover_id`,
      )
    ).rowCount;

    // CRM6 production orders (cascades rolling, skinpass, stoppages, remarks, etc.)
    summary.crm6Orders = (
      await client.query('DELETE FROM txn.crm6_order RETURNING order_id')
    ).rowCount;

    // Process route / assignment journey (references ppc_batch)
    summary.queueHandoff = (
      await client.query('DELETE FROM planning.queue_handoff RETURNING handoff_id')
    ).rowCount;

    summary.journeySteps = (
      await client.query('DELETE FROM planning.order_journey_step RETURNING step_id')
    ).rowCount;

    summary.journeys = (
      await client.query('DELETE FROM planning.order_journey RETURNING journey_id')
    ).rowCount;

    summary.rollingPassPlans = (
      await client.query('DELETE FROM planning.ppc_rolling_pass_plan RETURNING batch_id')
    ).rowCount;

    // PPC import queue
    summary.ppcBatches = (
      await client.query('DELETE FROM planning.ppc_batch RETURNING batch_id')
    ).rowCount;

    summary.importBatches = (
      await client.query('DELETE FROM planning.import_batch RETURNING import_batch_id')
    ).rowCount;

    // Legacy SAP-style planning import
    summary.coilPlans = (
      await client.query('DELETE FROM planning.coil_plan RETURNING coil_plan_id')
    ).rowCount;

    summary.planOrders = (
      await client.query('DELETE FROM planning.plan_order RETURNING plan_order_id')
    ).rowCount;

    // Planning-only coils (no production txn references)
    summary.plannedCoils = (
      await client.query(
        `DELETE FROM coil.coil c
         WHERE c.status = 'PLANNED'
           AND NOT EXISTS (SELECT 1 FROM txn.crm6_order o WHERE o.coil_no = c.coil_no)
           AND NOT EXISTS (SELECT 1 FROM txn.prod_hrs p WHERE p.coil_no = c.coil_no)
           AND NOT EXISTS (SELECT 1 FROM txn.prod_pkl p WHERE p.coil_no = c.coil_no)
           AND NOT EXISTS (SELECT 1 FROM txn.prod_crm p WHERE p.coil_no = c.coil_no)
           AND NOT EXISTS (SELECT 1 FROM txn.prod_crs p WHERE p.coil_no = c.coil_no)
           AND NOT EXISTS (SELECT 1 FROM txn.prod_skp p WHERE p.coil_no = c.coil_no)
           AND NOT EXISTS (SELECT 1 FROM txn.prod_rwd p WHERE p.coil_no = c.coil_no)
           AND NOT EXISTS (SELECT 1 FROM txn.prod_ctl p WHERE p.coil_no = c.coil_no)
         RETURNING coil_no`,
      )
    ).rowCount;

    await client.query('COMMIT');

    summary.remainingOrders = await count(client, 'SELECT COUNT(*)::int AS n FROM txn.crm6_order');
    summary.remainingPpcBatches = await count(client, 'SELECT COUNT(*)::int AS n FROM planning.ppc_batch');
    summary.remainingImportBatches = await count(client, 'SELECT COUNT(*)::int AS n FROM planning.import_batch');

    return summary;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1]?.includes('clear-order-data');
if (isMain) {
  console.log('=== Clear order & import data (preserve users & masters) ===\n');
  clearOrderData()
    .then((summary) => {
      console.log('Deleted:');
      for (const [key, value] of Object.entries(summary)) {
        if (key.startsWith('remaining')) continue;
        console.log(`  ${key}: ${value}`);
      }
      console.log('\nRemaining:');
      console.log(`  crm6 orders: ${summary.remainingOrders}`);
      console.log(`  ppc batches: ${summary.remainingPpcBatches}`);
      console.log(`  import batches: ${summary.remainingImportBatches}`);
      console.log('\nClear complete.');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
