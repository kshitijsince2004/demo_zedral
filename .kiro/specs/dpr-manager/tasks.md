# Implementation Plan: DPR Manager

## Overview

This plan implements DPR Manager as a new bounded slice in the ZedralV2 monorepo: a TypeScript Express/Kysely backend under `packages/server/src/dpr` and a React PWA frontend under `packages/client/src/components/dpr`. The build proceeds bottom-up so each step is validated through code before the next depends on it: the pure Geometry Model first (it underpins every other layer), then the data layer and repositories, then the Stage-1 Source Map Service, then the Import Service and Reconstruction Engine (which both produce a `Blank_Master`), then the Integration Layer of source adapters, then the ExcelJS Export Engine, then the API routes, and finally the frontend screens wired end-to-end. Property-based tests (using the repo's existing `fast-check`) sit next to the pure logic they validate, mapped to the 17 correctness properties in the design.

## Tasks

- [x] 1. Establish DPR module scaffolding and shared types
  - Create the `packages/server/src/dpr/` directory tree (`geometry/`, `source-map/`, `import/`, `reconstruct/`, `integration/`, `export/`, `repositories/`) matching the design's backend module layout
  - Add `dpr/dprTypes.ts` with shared TS types (`CellRef`, `DayValues`, `DelayRow`, field/source enums) referenced across layers
  - Confirm `exceljs` and `fast-check` are present in `packages/server/package.json`; do not add SheetJS for writing
  - _Requirements: 7.1, 15.1_

- [x] 2. Implement the pure Workbook Geometry Model
  - [x] 2.1 Implement block geometry functions
    - Create `dpr/geometry/blockGeometry.ts` with `BLOCK_STRIDE = 46`, `titleRow(N)` (day 1 = 2; day N>1 = `49 + (N-2)*46`), `machineRow(N, offset)`, and `delayBlockIndex(N, shiftIndex)`
    - _Requirements: 8.1, 8.2, 9.2_

  - [x]* 2.2 Write property test for title row formula
    - **Property 1: Title row formula is correct for every day**
    - **Validates: Requirements 8.1, 18.2, 18.3**

  - [x]* 2.3 Write property test for machine absolute row composition
    - **Property 2: Machine absolute row composition**
    - **Validates: Requirements 8.2, 18.3**

  - [x]* 2.4 Write property test for delay block index mapping
    - **Property 3: Delay block index mapping**
    - **Validates: Requirements 9.2**

  - [x] 2.5 Implement month calendar and identity helpers
    - Create `dpr/geometry/monthCalendar.ts` with `daysInMonth(year, month)` (leap-year aware), `monthSheetName` (`JUNE26`), `dprFilename` (`DPR June 2026.xlsx`), and `dateString` (`dd.mm.yyyy`)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.1_

  - [x]* 2.6 Write property test for days-in-month calendar correctness
    - **Property 4: Days-in-month is calendar-correct including leap years**
    - **Validates: Requirements 11.1**

  - [x] 2.7 Implement the DPR field-to-column map
    - Create `dpr/geometry/columnMap.ts` encoding production cols C/D/E, stoppage cols (electrical Z/AA/AB, mechanical AD/AE/AF, operational AH/AI/AJ), availability AL/AM/AN, prev-maint AP, power-failure AR/AS/AT, R/M shortage BB/BC/BD, scrap blocks BI–BT, day-number col BH, date col M, and the `NEVER_WRITE_COLS` set (F, G, H, X and formula cols)
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.3_

- [x] 3. Implement the data layer and repositories
  - [x] 3.1 Create the `dpr` schema migration
    - Add a `node-pg-migrate` SQL migration under `packages/server/migrations/` creating `dpr.template`, `dpr.source_map`, `dpr.month`, `dpr.daily_entry`, and `dpr.field_mapping` with the columns, JSONB fields, blob columns, and the `(month_id, day_number)` unique constraint from the design
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 7.3_

  - [x] 3.2 Implement Template and Month repositories
    - Create `repositories/DprTemplateRepository.ts` (persist both blobs with `original_file_blob` nullable for reconstructed origin, geometry fields) and `repositories/DprMonthRepository.ts` (month, year, sheet code, days-in-month, config overrides, status)
    - _Requirements: 15.1, 15.2, 15.4_

  - [x] 3.3 Implement Entry and Source Map repositories
    - Create `repositories/DprEntryRepository.ts` (values, delay_data, field_provenance JSONB, status; enforce sequential `(month_id, day_number)`) and `repositories/DprSourceMapRepository.ts`
    - _Requirements: 15.3, 15.5_

- [x] 4. Checkpoint - geometry and data layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the Stage-1 Source Map Service
  - [x] 5.1 Implement codebase inventory scanners and source map types
    - Create `source-map/sourceMapTypes.ts` and `source-map/codebaseInventory.ts` that read the DB information schema (`txn`/`planning`/`master`), enumerate Express routes, and inspect known service exports against the Geometry Model field catalog
    - _Requirements: 1.1, 1.2_

  - [x] 5.2 Implement Source Map classification and discovery orchestration
    - Create `source-map/SourceMapService.ts` with `discover()` classifying each field as `auto-sourced` / `needs-confirmation` / `manual`, emitting open questions for ambiguous mappings, plus `rediscover(extraLocations)`
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 5.3 Implement clarifying-question handling
    - Add `answerQuestion(questionId, answer)` that updates the matching Source Map entry, sets status to `confirmed`, and records machine-to-identifier, unit, and grain decisions; present finite-answer questions with selectable options
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 6. Implement the Import Service (Principles A & B)
  - [x] 6.1 Implement structure detection and cell classification
    - Create `import/structureDetector.ts` (scan column K for `DATE` to get block stride, column A for machine labels and `LINE` marker) and `import/cellClassifier.ts` assigning each cell exactly one of Formula_Cell / Daily_Input_Cell / Config_Cell, all via ExcelJS load (never SheetJS)
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [x]* 6.2 Write property test for cell classification totality
    - **Property 6: Cell classification is total and disjoint**
    - **Validates: Requirements 3.5**

  - [x] 6.3 Implement template upload, validation, and persistence
    - Create `import/ImportService.ts#importTemplate` that stores the original blob, validates the workbook is readable `.xlsx`, runs structure validation (main sheet, `DATE` marker, `LINE` marker), and returns descriptive errors naming the failed check
    - _Requirements: 3.1, 3.6, 3.7_

  - [x] 6.4 Implement Blank_Master generation
    - Create `import/blankMasterBuilder.ts` and `ImportService#buildBlankMaster` that set every Daily_Input_Cell to numeric `0` (never empty) while preserving all formulas, config cells, labels, merges, fonts, colors, widths, and heights
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x]* 6.5 Write property test for blank master zeroing
    - **Property 5: Blank master zeroes exactly the daily-input cells**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 7. Implement the Reconstruction Engine (Principle C)
  - [x] 7.1 Implement Color Legend and Named Styles
    - Create `reconstruct/colorLegend.ts` (resolved RGB hex fills, no theme indices) and `reconstruct/namedStyles.ts` defining `title`, `hdr`, `inputY`, `inputCyan`, `calc`, `tgt`, `silver`, `ot`, `attn` each pairing fill, font, alignment, border, and number format
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 21.1, 21.2, 21.3, 21.4, 21.6_

  - [x] 7.2 Implement Block Anatomy geometry and merges
    - Create `reconstruct/blockAnatomy.ts` encoding the per-offset regions (title row, header band 1–3, 26 machine/area rows 4–29, summary band 30–41, MAJOR STOPPAGES note 45), per-offset row heights, column widths A–DB, and the 73 merged-cell ranges per block
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 20.1, 20.2, 20.3, 20.4, 20.5_

  - [x] 7.3 Implement the intra-sheet Formula Catalog
    - Create `reconstruct/formulaCatalog.ts` writing only intra-sheet formulas: `F = C+D+E`, day-1 cumulative `G = F`, day-N cumulative `G = F + previous-block-G-at-same-offset`, `H = G/BH`, electrical/mechanical/operational totals, stoppage/utilisation totals (HPH divisor `16*24*60`, CRS-5 divisor `7*24*60`), prod rate, availability/prev-maint/power-failure cumulatives, grand total, scrap/rejection totals and percentages, W/R change sums, daily SUM, and yield
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8_

  - [x]* 7.4 Write property test for intra-sheet formula chaining
    - **Property 15: Reconstruction writes only intra-sheet formulas with correct chaining**
    - **Validates: Requirements 22.1, 22.2, 22.4, 22.5, 22.8**

  - [x]* 7.5 Write property test for production and cumulative formula shapes
    - **Property 16: Production and cumulative formula shapes are correct**
    - **Validates: Requirements 22.3, 22.4, 22.6**

  - [x] 7.6 Implement Delay_Sheet reconstruction
    - Build the `DELAY` sheet repeating shift-block (header rows at 1/21/41/62/83… stride ~20, 93 blocks, 19 machine line rows per block) with Yellow `FFFF00` headers, Calibri 12 bold, medium box borders, and the A–F column labels/inputs
    - _Requirements: 24.1, 24.2, 24.4, 24.5, 18.7_

  - [x] 7.7 Implement reconstruction orchestration and verification
    - Create `reconstruct/ReconstructionEngine.ts#reconstruct` building exactly two sheets (Main first, `DELAY` second) and 31 Day_Blocks, plus `reconstruct/verification.ts` checking tab name, block count/geometry, dimensions, fills/fonts, 73 merges/block, intra-sheet formula chaining, number formats, and Delay header formatting individually; store result as Blank_Master and fail closed when any check fails
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8, 24.3_

  - [x]* 7.8 Write property test for verification fail-closed behavior
    - **Property 17: Reconstruction verification fails closed**
    - **Validates: Requirements 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8, 24.3**

- [x] 8. Checkpoint - import and reconstruction produce a Blank_Master
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the Integration Layer and editable field mappings
  - [x] 9.1 Implement the field mapping store and adapter interface
    - Create `integration/fieldMappingStore.ts` (reads editable `dpr.field_mapping` records) and the `DprSourceAdapter` interface plus `IntegrationLayer.ts#resolveForDay` that fans out to registered adapters and merges per active mapping
    - _Requirements: 7.1, 7.3, 7.4_

  - [x] 9.2 Implement the source adapters
    - Create `integration/adapters/ProductionAdapter.ts`, `StoppageAdapter.ts`, `DispositionAdapter.ts`, and `TargetAdapter.ts` resolving shift A/B/C production, category minutes, scrap/rejection/trim/b.slit, and target config defaults; each registered via one array entry so adding one never edits the Export_Engine
    - _Requirements: 6.1, 7.1, 7.2_

  - [x] 9.3 Implement mapping-edit application
    - Add `IntegrationLayer#applyMappingEdit` so subsequent resolutions honor edited mappings; resolve missing source data to `null`/`0` with `MANUAL` provenance rather than failing the day load
    - _Requirements: 7.4, 6.4_

- [x] 10. Implement daily entry persistence, provenance, and sequential integrity
  - [x] 10.1 Implement day-save logic with provenance and zero defaults
    - Implement save logic that records Field_Provenance per value (`auto-sourced` vs `manual`), stores numeric `0` for empty manual fields, flips overridden auto fields to `manual`, and allows saving a day without entries for unselected machines
    - _Requirements: 6.3, 6.5, 6.6, 6.7, 12.2_

  - [x]* 10.2 Write property test for manual field defaults and provenance
    - **Property 12: Manual fields default to zero with manual provenance**
    - **Validates: Requirements 6.3, 6.5, 6.6**

  - [x] 10.3 Implement sequential-entry guard and day-status
    - Block entry of day N unless days 1..N-1 exist; expose a per-day entered/zero status indicator
    - _Requirements: 12.1, 12.4_

  - [x]* 10.4 Write property test for sequential entry enforcement
    - **Property 11: Sequential entry is enforced**
    - **Validates: Requirements 12.1**

  - [x] 10.5 Implement Month Setup config and start-new-month
    - Implement config-override handling (target B, prod-rate V, target-% rows, day-count seed X) never zeroing Config_Cells, and start-new-month that creates a new month dataset against the existing Template, leaves the Blank_Master byte-unchanged, initializes all Daily_Input_Cells to `0`, and resets cumulatives
    - _Requirements: 16.1, 16.2, 16.3, 14.1, 14.2, 14.3, 12.3_

  - [x]* 10.6 Write property test for start-new-month invariants
    - **Property 14: Start-new-month preserves the mold and resets cumulatives**
    - **Validates: Requirements 12.3, 14.1, 14.2, 14.3**

- [x] 11. Implement the Export Engine (ExcelJS injection)
  - [x] 11.1 Implement the write allow-list guard
    - Create `export/writeAllowList.ts` exposing `assertWritable(sheet, cellRef)` that permits only Daily_Input_Cells, date cells, the tab rename, and trailing-block deletion, and throws on any Formula_Cell write
    - _Requirements: 5.2, 5.3, 8.7_

  - [x]* 11.2 Write property test for export write allow-list
    - **Property 7: Export never writes outside the allow-list**
    - **Validates: Requirements 5.2, 5.3, 8.7**

  - [x] 11.3 Implement month identity rewrite and trailing-block trimmer
    - Create `export/monthIdentity.ts` (tab rename `<MONTHNAME><YY>`, `dd.mm.yyyy` date strings to main col M and DELAY col B preserving the date number format, filename `DPR <Month> <Year>.xlsx`) and `export/blockTrimmer.ts` deleting only surplus trailing blocks from the bottom upward on both sheets to leave exactly D blocks
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.2, 11.3, 11.4, 11.5_

  - [x]* 11.4 Write property test for month identity rewrite
    - **Property 13: Month identity rewrite is consistent**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

  - [x]* 11.5 Write property test for trailing-block trim
    - **Property 10: Trailing-block trim yields exactly D blocks from the bottom**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5**

  - [x] 11.6 Implement the core ExcelJS injection export
    - Create `export/ExportEngine.ts#export` that loads the Blank_Master, injects each saved day's combined auto-sourced and manual values, writes the day number to col BH and dates, injects Delay_Log rows (raw string times like `210--160`/`NIL` allowed), leaves unentered days' input cells at `0`, applies config overrides, and produces output via `writeBuffer` using only ExcelJS
    - _Requirements: 5.1, 5.4, 5.5, 9.1, 9.3, 9.4, 9.5, 13.1, 13.2, 13.3, 13.4_

  - [x]* 11.7 Write property test for unentered days exporting as zero
    - **Property 9: Unentered days export as zero**
    - **Validates: Requirements 13.1, 13.2**

  - [x]* 11.8 Write property test for export preserving formulas and styles
    - **Property 8: Export preserves all template formulas and styles**
    - **Validates: Requirements 4.4, 5.5, 13.3**

- [x] 12. Checkpoint - end-to-end backend path
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement and wire the API routes
  - [x] 13.1 Implement source-map, template, and month routes
    - Create `dprSourceMapRoutes`, `dprTemplateRoutes` (import + reconstruct), and `dprMonthRoutes`, reusing existing `authMiddleware` and Reviewer/Supervisor role checks; return `400` for invalid uploads and `422` naming failed structure checks
    - _Requirements: 1.6, 2.3, 3.1, 3.6, 3.7, 14.1, 16.3, 17.1_

  - [x] 13.2 Implement entry and export routes
    - Create `dprEntryRoutes` (day save, returns `409` with missing day numbers on out-of-order save) and `dprExportRoutes` (`POST /dpr/months/:id/export` streaming the `.xlsx`); mount all DPR routes under `app.use('/dpr', dprRoutes)` in `packages/server/src/index.ts`
    - _Requirements: 6.1, 12.1, 13.1, 13.4_

  - [x]* 13.3 Write integration tests for the backend export flow
    - Import sample workbook → build Blank_Master → setup month → save auto+manual days → export → reopen with ExcelJS asserting formulas intact, tab renamed, exactly D blocks, unentered days zero; plus start-new-month blob-unchanged and adapter-swap tests
    - _Requirements: 5.5, 7.2, 11.5, 13.3, 14.2_

- [x] 14. Implement the frontend screens
  - [x] 14.1 Implement the DPR client API module
    - Create `packages/client/src/lib/dprClient.ts` mirroring `apiClient.ts` conventions for source-map, template/reconstruct, month, entry, and export endpoints
    - _Requirements: 6.1, 7.3_

  - [x] 14.2 Implement Source Map Review and Template Import screens
    - Create `components/dpr/SourceMapReview.tsx` (entry table with confidence badges, open-question cards with selectable options) and `components/dpr/TemplateImport.tsx` (upload + structure-detection summary + "Reconstruct instead" action)
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 3.1, 17.1_

  - [x] 14.3 Implement Month Setup, Daily Entry Grid, and Delay Log screens
    - Create `components/dpr/MonthSetup.tsx` (editable config defaults), `components/dpr/DailyEntryGrid.tsx` (auto-sourced cells pre-filled and flagged, editable overrides, optional manual cells, day-status indicator, sequential-entry guard), and `components/dpr/DelayLog.tsx` (three shift blocks, free-text time/agency/reason)
    - _Requirements: 6.2, 6.3, 6.4, 6.7, 9.1, 12.1, 12.4, 16.1_

  - [x] 14.4 Implement Export controls and field-mapping edit UI
    - Create `components/dpr/DprExportControls.tsx` (export current month, start-new-month) and a field-mapping edit control that calls `applyMappingEdit`
    - _Requirements: 7.3, 13.1, 14.1_

  - [x]* 14.5 Write component tests for entry grid and source map review
    - Test auto-sourced flagging, override acceptance, sequential-entry block, day-status indicator, and open-question option rendering
    - _Requirements: 2.2, 6.2, 6.3, 12.1, 12.4_

- [x] 15. Final checkpoint - full feature wired end-to-end
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP; they cover unit, property, and integration tests.
- Each task references specific granular requirements clauses for traceability.
- Checkpoints ensure incremental validation at natural layer boundaries (geometry/data, import/reconstruction, backend export, full wiring).
- Property tests (Properties 1–17 from the design) validate the pure logic core and are placed next to their implementations so off-by-one and boundary bugs surface early; each runs a minimum of 100 `fast-check` iterations.
- Visual-fidelity requirements (18–21, 24) are validated through the built-in Verification_Checklist (Property 17) and reconstruction snapshot/example tests rather than standalone property tests.
- All workbook writes use ExcelJS; SheetJS (`xlsx`) is never used for writing, per Principles B and C.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.5", "2.7", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.6", "3.2", "3.3"] },
    { "id": 3, "tasks": ["5.1", "6.1", "7.1", "7.2", "7.3"] },
    { "id": 4, "tasks": ["5.2", "6.2", "6.3", "7.4", "7.5", "7.6"] },
    { "id": 5, "tasks": ["5.3", "6.4", "7.7"] },
    { "id": 6, "tasks": ["6.5", "7.8", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "10.1", "10.3", "10.5"] },
    { "id": 8, "tasks": ["10.2", "10.4", "10.6", "11.1", "11.3"] },
    { "id": 9, "tasks": ["11.2", "11.4", "11.5", "11.6"] },
    { "id": 10, "tasks": ["11.7", "11.8", "13.1", "13.2"] },
    { "id": 11, "tasks": ["13.3", "14.1"] },
    { "id": 12, "tasks": ["14.2", "14.3", "14.4"] },
    { "id": 13, "tasks": ["14.5"] }
  ]
}
```
