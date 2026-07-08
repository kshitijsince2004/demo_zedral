\echo '=== crm6_rolling row existence ==='
SELECT o.batch_number, o.status, pb.sub_process,
       (r.order_id IS NOT NULL) as has_rolling_row,
       r.actual_weight_mt, r.total_passes
FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id=o.batch_id
LEFT JOIN txn.crm6_rolling r ON r.order_id=o.order_id
WHERE pb.machine_code='6HI' AND o.status='COMPLETED'
ORDER BY o.updated_at DESC LIMIT 12;

\echo '=== 6HI ppc batches by plan_date ==='
SELECT plan_date, COUNT(*)::int, SUM(CASE WHEN machine_allocated THEN 1 ELSE 0 END)::int as allocated
FROM planning.ppc_batch WHERE machine_code='6HI' AND plan_date >= '2026-07-01'
GROUP BY plan_date ORDER BY plan_date DESC;

\echo '=== badges ==='
SELECT badge_id, full_name FROM security.app_user WHERE is_active=true ORDER BY user_id LIMIT 8;
