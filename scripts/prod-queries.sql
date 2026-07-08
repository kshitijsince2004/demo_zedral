\echo '=== SHIFT LOGS 6HI ==='
SELECT sl.shift_log_id, sl.prod_date, sl.shift_code, sl.target_mt, sl.total_prod_mt, sl.state
FROM txn.shift_log sl JOIN master.process p ON p.process_id=sl.process_id
WHERE p.code='6HI' ORDER BY sl.prod_date DESC LIMIT 15;

\echo '=== PPC BATCHES recent ==='
SELECT batch_number, plan_date, shift_code, machine_code, queue_seq, sub_process, ppc_weight_mt, machine_allocated
FROM planning.ppc_batch WHERE plan_date >= '2026-06-08' ORDER BY plan_date DESC, queue_seq LIMIT 25;

\echo '=== ORDER WEIGHTS ==='
SELECT o.batch_number, o.status, o.shift_log_id, pb.plan_date, pb.shift_code,
       r.actual_weight_mt as rolling_mt, s.actual_weight_mt as skinpass_mt, pb.ppc_weight_mt,
       o.prod_start_at, o.updated_at
FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id=o.batch_id
LEFT JOIN txn.crm6_rolling r ON r.order_id=o.order_id
LEFT JOIN txn.crm6_skinpass s ON s.order_id=o.order_id
WHERE o.status IN ('IN_PROGRESS','STOPPAGE','COMPLETED','PREPARING')
ORDER BY o.updated_at DESC LIMIT 20;

\echo '=== MACHINE STATUS ==='
SELECT machine_code, machine_status FROM master.machine WHERE machine_code='6HI';

\echo '=== MACHINE EVENTS 6HI ==='
SELECT event_type, batch_number, category_code, occurred_at, ended_at
FROM txn.machine_state_event WHERE machine_code='6HI' ORDER BY occurred_at DESC LIMIT 12;

\echo '=== SHIFT LOG FOR 2026-07-07 ==='
SELECT sl.shift_log_id, sl.prod_date, sl.shift_code FROM txn.shift_log sl
JOIN master.process p ON p.process_id=sl.process_id
WHERE p.code='6HI' AND sl.prod_date='2026-07-07';

\echo '=== SHIFT LOG FOR 2026-07-06 ==='
SELECT sl.shift_log_id, sl.prod_date, sl.shift_code, sl.total_prod_mt FROM txn.shift_log sl
JOIN master.process p ON p.process_id=sl.process_id
WHERE p.code='6HI' AND sl.prod_date='2026-07-06';

\echo '=== ORDERS ON 2026-06-09 (active) ==='
SELECT o.batch_number, o.status, o.shift_log_id, r.actual_weight_mt, s.actual_weight_mt
FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id=o.batch_id
LEFT JOIN txn.crm6_rolling r ON r.order_id=o.order_id
LEFT JOIN txn.crm6_skinpass s ON s.order_id=o.order_id
WHERE pb.plan_date='2026-06-09' AND o.status='IN_PROGRESS';
