/**
 * Audit 6HI shift attribution integrity.
 *
 * Reports:
 *  - misattributedOrders: started orders whose recorded (prod_date, shift_code) differs
 *    from the shift resolved from prod_start_at (plant TZ, overnight-aware). Should be 0
 *    once production-start re-attribution + the backfill migration are in place.
 *  - shiftLogsWithCacheDrift: 6HI shift logs whose cached total_prod_mt disagrees with the
 *    live recomputed production total. Should be 0.
 *
 * Run: node scripts/audit-shift-attribution.mjs
 */
import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const q = async (s) => (await client.query(s)).rows;

const misattributed = await q(`
  WITH resolved AS (
    SELECT o.order_id,
           o.prod_date  AS cur_date,
           o.shift_code AS cur_code,
           (o.prod_start_at AT TIME ZONE 'Asia/Kolkata')::date AS ld,
           (o.prod_start_at AT TIME ZONE 'Asia/Kolkata')::time AS lt
    FROM txn.crm6_order o
    WHERE o.prod_start_at IS NOT NULL
  ), matched AS (
    SELECT r.order_id, r.cur_date, r.cur_code,
      (SELECT s.shift_code FROM master.shift s
        WHERE (s.end_time > s.start_time AND r.lt >= s.start_time AND r.lt < s.end_time)
           OR (s.end_time <= s.start_time AND (r.lt >= s.start_time OR r.lt < s.end_time))
        LIMIT 1) AS tgt_code,
      CASE WHEN EXISTS (
        SELECT 1 FROM master.shift s
        WHERE s.end_time <= s.start_time AND r.lt < s.end_time
      ) THEN r.ld - 1 ELSE r.ld END AS tgt_date
    FROM resolved r
  )
  SELECT count(*)::int AS n
  FROM matched
  WHERE tgt_code IS NOT NULL
    AND (cur_date IS DISTINCT FROM tgt_date OR cur_code IS DISTINCT FROM tgt_code)
`);

const cacheDrift = await q(`
  WITH pid AS (SELECT process_id FROM master.process WHERE code='6HI'),
  recomputed AS (
    SELECT o.shift_log_id,
      SUM(CASE
        WHEN o.status='COMPLETED' THEN COALESCE(w.aw, o.ppc_weight_mt, 0)
        WHEN o.status IN ('IN_PROGRESS','STOPPAGE') THEN GREATEST(COALESCE(w.aw,0),0)
        ELSE 0 END) AS total
    FROM txn.crm6_order o
    LEFT JOIN LATERAL (
      SELECT CASE WHEN o.sub_process='ROLLING'
        THEN (SELECT actual_weight_mt FROM txn.crm6_rolling ro WHERE ro.order_id=o.order_id)
        ELSE (SELECT actual_weight_mt FROM txn.crm6_skinpass sk WHERE sk.order_id=o.order_id) END AS aw
    ) w ON TRUE
    WHERE o.shift_log_id IS NOT NULL GROUP BY o.shift_log_id
  )
  SELECT count(*)::int AS n
  FROM txn.shift_log sl
  JOIN recomputed rc ON rc.shift_log_id = sl.shift_log_id
  WHERE sl.process_id = (SELECT process_id FROM pid)
    AND round(COALESCE(sl.total_prod_mt,0)::numeric, 3) <> round(rc.total::numeric, 3)
`);

console.log(JSON.stringify({ misattributedOrders: misattributed[0].n, shiftLogsWithCacheDrift: cacheDrift[0].n }, null, 2));
await client.end();
