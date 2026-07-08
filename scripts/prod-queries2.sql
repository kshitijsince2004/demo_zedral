\echo '=== PPC weight sum shift_log 2 completed ==='
SELECT SUM(pb.ppc_weight_mt) FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id=o.batch_id
WHERE o.shift_log_id=2 AND o.status='COMPLETED';

\echo '=== crm6_rolling rows for completed orders ==='
SELECT o.batch_number, r.actual_weight_mt, r.created_at, r.updated_at
FROM txn.crm6_order o
LEFT JOIN txn.crm6_rolling r ON r.order_id=o.order_id
WHERE o.shift_log_id=2 AND o.status='COMPLETED' LIMIT 15;

\echo '=== crm6_skinpass rows ==='
SELECT o.batch_number, s.actual_weight_mt FROM txn.crm6_order o
LEFT JOIN txn.crm6_skinpass s ON s.order_id=o.order_id
WHERE o.shift_log_id=2 LIMIT 15;

\echo '=== master.shift windows ==='
SELECT shift_code, name, start_time, end_time FROM master.shift ORDER BY start_time;

\echo '=== shift_log all processes today ==='
SELECT p.code, sl.shift_log_id, sl.prod_date, sl.shift_code, sl.total_prod_mt
FROM txn.shift_log sl JOIN master.process p ON p.process_id=sl.process_id
WHERE sl.prod_date >= '2026-07-06' ORDER BY sl.prod_date, p.code;

\echo '=== order shift_log_id vs plan_date mismatch ==='
SELECT COUNT(*) as mismatched FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id=o.batch_id
WHERE o.shift_log_id IS NOT NULL AND pb.plan_date != (
  SELECT sl.prod_date FROM txn.shift_log sl WHERE sl.shift_log_id=o.shift_log_id
);

\echo '=== sample mismatch rows ==='
SELECT o.batch_number, pb.plan_date, sl.prod_date as shift_log_date, o.status
FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id=o.batch_id
JOIN txn.shift_log sl ON sl.shift_log_id=o.shift_log_id
WHERE pb.plan_date != sl.prod_date LIMIT 10;
