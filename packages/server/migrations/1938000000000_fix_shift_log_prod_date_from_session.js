/**
 * Off-by-one fix: shift_log.prod_date was often written from a JS Date at IST
 * midnight, which Postgres DATE on UTC hosts stored as the previous calendar day.
 * machine_shift_session.prod_date used postgresDateOnly (correct plant day).
 * Sync shift_log.prod_date from its sessions.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
        UPDATE txn.shift_log sl
        SET prod_date = sub.session_day
        FROM (
            SELECT
                shift_log_id,
                MIN(prod_date)::date AS session_day
            FROM txn.machine_shift_session
            WHERE shift_log_id IS NOT NULL
            GROUP BY shift_log_id
        ) sub
        WHERE sl.shift_log_id = sub.shift_log_id
            AND sl.prod_date IS DISTINCT FROM sub.session_day;
    `);
};

exports.down = () => {
    // Irreversible data repair.
};