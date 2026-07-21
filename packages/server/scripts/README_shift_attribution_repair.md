# Legacy shift attribution repair

## Runtime path (preferred)

Production start / hold reattributes via `SixHiService.reattributeOrderToActiveShift`
(ACTIVE machine session → override → clock). Migration
`1909000000000_reattribute_backlog_production_shift.js` repairs historical
backlog rows using wall-clock from `prod_start_at`.

## One-off SQL scripts

The original workspace scripts `fix_shift_attribution.sql` and
`fix_shift_attribution_v2.sql` were referenced by Task 5 but were **not present**
in this repo checkout or sibling folders at implement time.

If you recover them from the Zedral Code workspace archive, place them here:

- `packages/server/scripts/fix_shift_attribution.sql`
- `packages/server/scripts/fix_shift_attribution_v2.sql`

Run manually against a backup-restored DB only — they are not part of
`npm run migrate`. Prefer the 190900 migration + runtime reattribute for new deploys.

## Finding 4.2 (confirmed)

`endProduction` does **not** reattribute. **Keep start-shift credit** — overtime
completes stay on the shift where production started. Do not change this path.