/**
 * Idempotent HRS child-coil weight/thickness repair.
 * Fixes rows minted at full mother weight (bug signature: child.weight_mt = mother.weight_mt).
 *
 * Usage:
 *   node scripts/reconcile-hrs-child-weights.mjs           # dry-run report
 *   node scripts/reconcile-hrs-child-weights.mjs --apply   # write updates
 */
import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const apply = process.argv.includes('--apply');

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundMt(value) {
  return Math.round(value * 1000) / 1000;
}

const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
await client.connect();

try {
  const { rows } = await client.query(`
    SELECT
      child.coil_no,
      child.weight_mt AS child_wt,
      child.coil_thk_mm AS child_thk,
      mother.coil_no AS mother_no,
      mother.weight_mt AS mother_wt,
      mother.coil_thk_mm AS mother_thk,
      slit.slot,
      slit.planned_weight_mt,
      slit.planned_thk_mm,
      slit.actual_weight_mt,
      slit.width_mm,
      slit.thk_latest_mm,
      slit.thk_id_mm,
      slit.thk_mm,
      EXISTS (
        SELECT 1 FROM txn.prod_pkl p WHERE p.coil_no = child.coil_no
      ) OR EXISTS (
        SELECT 1 FROM txn.prod_crs c WHERE c.coil_no = child.coil_no
      ) OR EXISTS (
        SELECT 1 FROM txn.crm_order o WHERE o.coil_no = child.coil_no
      ) OR EXISTS (
        SELECT 1 FROM txn.prod_rwd r WHERE r.coil_no = child.coil_no
      ) AS downstream_consumed
    FROM coil.coil child
    JOIN coil.coil mother ON mother.coil_no = child.parent_coil_no
    JOIN txn.prod_hrs_slit slit
      ON slit.child_coil_no = child.coil_no
      OR child.coil_no = mother.coil_no || '-' || slit.slot
    JOIN txn.prod_hrs hrs ON hrs.entry_id = slit.entry_id AND hrs.coil_no = mother.coil_no
    WHERE child.parent_coil_no IS NOT NULL
      AND child.weight_mt IS NOT NULL
      AND mother.weight_mt IS NOT NULL
      AND child.weight_mt = mother.weight_mt
  `);

  const byMother = new Map();
  for (const row of rows) {
    const list = byMother.get(row.mother_no) ?? [];
    list.push(row);
    byMother.set(row.mother_no, list);
  }

  const updates = [];
  let skippedDownstream = 0;
  let beforeChildSum = 0;
  let afterChildSum = 0;
  let motherSum = 0;

  for (const [motherNo, siblings] of byMother) {
    const unique = [];
    const seen = new Set();
    for (const s of siblings) {
      if (seen.has(s.coil_no)) continue;
      seen.add(s.coil_no);
      unique.push(s);
    }
    const motherWt = num(unique[0]?.mother_wt) ?? 0;
    motherSum += motherWt;
    const widths = unique.map((s) => num(s.width_mm)).filter((w) => w != null && w > 0);
    const totalW = widths.reduce((a, b) => a + b, 0);

    for (const row of unique) {
      beforeChildSum += num(row.child_wt) ?? 0;
      if (row.downstream_consumed) {
        skippedDownstream += 1;
        afterChildSum += num(row.child_wt) ?? 0;
        continue;
      }
      const actual = num(row.actual_weight_mt);
      const planned = num(row.planned_weight_mt);
      const w = num(row.width_mm);
      let nextWt = actual ?? planned;
      if (nextWt == null) {
        nextWt = totalW > 0 && w != null && w > 0
          ? roundMt((w / totalW) * motherWt)
          : roundMt(motherWt / Math.max(unique.length, 1));
      }
      const nextThk =
        num(row.thk_latest_mm) ??
        num(row.planned_thk_mm) ??
        num(row.thk_id_mm) ??
        num(row.thk_mm) ??
        num(row.child_thk) ??
        num(row.mother_thk);
      afterChildSum += nextWt;
      if (nextWt !== num(row.child_wt) || (nextThk != null && nextThk !== num(row.child_thk))) {
        updates.push({
          coil_no: row.coil_no,
          mother_no: motherNo,
          from_wt: num(row.child_wt),
          to_wt: nextWt,
          from_thk: num(row.child_thk),
          to_thk: nextThk,
        });
      }
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    candidates: rows.length,
    updates: updates.length,
    skippedDownstream,
    beforeChildSum: roundMt(beforeChildSum),
    afterChildSum: roundMt(afterChildSum),
    motherSum: roundMt(motherSum),
    sample: updates.slice(0, 20),
  }, null, 2));

  if (apply && updates.length > 0) {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(
        `UPDATE coil.coil SET weight_mt = $1, coil_thk_mm = COALESCE($2, coil_thk_mm) WHERE coil_no = $3`,
        [u.to_wt, u.to_thk, u.coil_no],
      );
    }
    await client.query('COMMIT');
    console.log(`Applied ${updates.length} coil.coil updates.`);
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
