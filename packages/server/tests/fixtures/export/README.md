# Export golden-test fixtures

## `may2026_subset.json`

JSON snapshot equivalent to a subset of **May 2026** captured data, aligned with spec §5.1 (`4HI_R` on `2026-05-01`). Used by Phase 2 unit tests for derivation and DELAY sheet behaviour.

## Reference workbook (Phase 3 golden-file)

Place the legacy reference file here when available:

- `DPR MAY 2026.xlsx` — cell-by-cell golden diff target for Phase 3 `dprGolden.test.ts`

Until the workbook is added, Phase 2 tests validate formulas and RDM shape against `may2026_subset.json` expected values.
