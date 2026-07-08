/**
 * Re-attribute historical 6HI orders to the shift in which they were ACTUALLY produced.
 *
 * Background:
 *   Orders are seeded with the PLANNED shift (copied from planning.ppc_batch at order
 *   creation). A backlog order (planned for a previous day/shift but produced later)
 *   therefore kept crediting production/KPIs to its original planned shift, inflating
 *   that shift and omitting the production from the shift where it actually ran.
 *
 *   Going forward this is handled at production start by
 *   SixHiService.reattributeOrderToActiveShift(). This migration corrects existing rows.
 *
 * What it does (idempotent, safe to re-run):
 *   1. For every 6HI order with a production start timestamp, derive the shift
 *      (prod_date + shift_code) in which prod_start_at falls, using master.shift windows
 *      in plant time (Asia/Kolkata) and honouring overnight shifts.
 *   2. Where that differs from the order's currently recorded shift, ensure a shift_log
 *      exists for the actual shift and MOVE the order (and its crm6_rolling child rows and
 *      any order_shift_attribution slices) to it. Orders are moved, never duplicated.
 *   3. Recompute the cached txn.shift_log.total_prod_mt for all 6HI shift logs so the
 *      denormalised totals match the (now correct) attribution.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      v_process_id smallint;
      r            RECORD;
      s            RECORD;
      v_local_ts   timestamp;
      v_date       date;
      v_time       time;
      v_target_date date;
      v_target_code varchar(4);
      v_shift_log_id bigint;
    BEGIN
      SELECT process_id INTO v_process_id FROM master.process WHERE code = '6HI';
      IF v_process_id IS NULL THEN
        RAISE NOTICE '6HI process not configured; skipping backlog re-attribution';
        RETURN;
      END IF;

      FOR r IN
        SELECT o.order_id,
               o.prod_start_at,
               o.prod_date  AS cur_prod_date,
               o.shift_code AS cur_shift_code
        FROM txn.crm6_order o
        WHERE o.prod_start_at IS NOT NULL
      LOOP
        -- Resolve the production shift from prod_start_at in plant local time.
        v_local_ts := (r.prod_start_at AT TIME ZONE 'Asia/Kolkata');
        v_date := v_local_ts::date;
        v_time := v_local_ts::time;

        v_target_date := NULL;
        v_target_code := NULL;

        FOR s IN SELECT shift_code, start_time, end_time FROM master.shift LOOP
          IF s.end_time > s.start_time THEN
            -- Normal (same-day) window.
            IF v_time >= s.start_time AND v_time < s.end_time THEN
              v_target_code := s.shift_code;
              v_target_date := v_date;
              EXIT;
            END IF;
          ELSE
            -- Overnight window (e.g. 22:00 -> 06:00).
            IF v_time >= s.start_time THEN
              v_target_code := s.shift_code;
              v_target_date := v_date;
              EXIT;
            ELSIF v_time < s.end_time THEN
              v_target_code := s.shift_code;
              v_target_date := v_date - 1;
              EXIT;
            END IF;
          END IF;
        END LOOP;

        -- Could not resolve a shift window; leave the order untouched.
        IF v_target_code IS NULL THEN
          CONTINUE;
        END IF;

        -- Already attributed to the actual production shift: nothing to correct.
        IF r.cur_prod_date IS NOT DISTINCT FROM v_target_date
           AND r.cur_shift_code IS NOT DISTINCT FROM v_target_code THEN
          CONTINUE;
        END IF;

        -- Ensure the target shift log exists (mill_type NULL matches app behaviour).
        SELECT shift_log_id INTO v_shift_log_id
        FROM txn.shift_log
        WHERE prod_date = v_target_date
          AND shift_code = v_target_code
          AND process_id = v_process_id
          AND mill_type IS NULL
        LIMIT 1;

        IF v_shift_log_id IS NULL THEN
          INSERT INTO txn.shift_log (prod_date, shift_code, process_id, mill_type, state)
          VALUES (v_target_date, v_target_code, v_process_id, NULL, 'DRAFT')
          RETURNING shift_log_id INTO v_shift_log_id;
        END IF;

        IF v_shift_log_id IS NULL THEN
          CONTINUE;
        END IF;

        -- Move the order and its child/attribution rows (never duplicated).
        UPDATE txn.crm6_order
        SET shift_log_id  = v_shift_log_id,
            prod_date     = v_target_date,
            production_day = v_target_date,
            shift_code    = v_target_code
        WHERE order_id = r.order_id;

        UPDATE txn.crm6_rolling
        SET shift_code = v_target_code,
            prod_date  = v_target_date
        WHERE order_id = r.order_id;

        -- Move attribution slices only where it will not collide with the
        -- (order_id, shift_log_id, machine_code) unique constraint.
        UPDATE txn.order_shift_attribution osa
        SET shift_log_id = v_shift_log_id,
            shift_code   = v_target_code,
            prod_date    = v_target_date
        WHERE osa.order_id = r.order_id
          AND NOT EXISTS (
            SELECT 1 FROM txn.order_shift_attribution x
            WHERE x.order_id = osa.order_id
              AND x.machine_code = osa.machine_code
              AND x.shift_log_id = v_shift_log_id
              AND x.attribution_id <> osa.attribution_id
          );
      END LOOP;

      -- Recompute cached production totals for every 6HI shift log so the
      -- denormalised value matches the corrected attribution.
      UPDATE txn.shift_log SET total_prod_mt = 0 WHERE process_id = v_process_id;

      UPDATE txn.shift_log sl
      SET total_prod_mt = agg.total
      FROM (
        SELECT o.shift_log_id,
               SUM(
                 CASE
                   WHEN o.status = 'COMPLETED'
                     THEN COALESCE(w.actual_weight_mt, o.ppc_weight_mt, 0)
                   WHEN o.status IN ('IN_PROGRESS', 'STOPPAGE')
                     THEN GREATEST(COALESCE(w.actual_weight_mt, 0), 0)
                   ELSE 0
                 END
               ) AS total
        FROM txn.crm6_order o
        LEFT JOIN LATERAL (
          SELECT CASE
                   WHEN o.sub_process = 'ROLLING'
                     THEN (SELECT ro.actual_weight_mt FROM txn.crm6_rolling ro WHERE ro.order_id = o.order_id)
                   ELSE (SELECT sk.actual_weight_mt FROM txn.crm6_skinpass sk WHERE sk.order_id = o.order_id)
                 END AS actual_weight_mt
        ) w ON TRUE
        WHERE o.shift_log_id IS NOT NULL
        GROUP BY o.shift_log_id
      ) agg
      WHERE sl.shift_log_id = agg.shift_log_id
        AND sl.process_id = v_process_id;
    END $$;
  `);
};

/**
 * Data-correction backfill; the previous (planned-shift) attribution cannot be
 * reconstructed reliably, so the down migration is intentionally a no-op.
 * @param {import('node-pg-migrate').MigrationBuilder} _pgm
 */
exports.down = (_pgm) => {
  // Irreversible data backfill — no-op.
};
