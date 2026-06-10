# Requirements Document

## Introduction

DPR Manager is a web application that digitizes the steel plant's monthly **Daily Production Report (DPR)** Excel workbook for Hero Steels Cold Rolling Steel Plant. It is built into the existing ZedralV2 monorepo (`packages/client` React frontend, `packages/server` Express/Kysely backend) and reuses existing capabilities: the `exceljs` server dependency, the DPR aggregation/export module under `packages/server/src/export`, the coil-level `AutoSourceService`, and the canonical M1 data store (`txn.shift_log`, `txn.prod_*`, `txn.stoppage_entry`, `planning.production_target`, etc.).

The blank master that drives every export can originate in one of two ways: by **uploading** last month's workbook and normalizing it (the import path), or by **programmatically reconstructing** the master workbook cell-for-cell in code (the reconstruction path). Both paths converge on the same artifact — a Blank_Master that is visually indistinguishable from the original master with only numeric data cleared — and both feed the same template-injection Export_Engine.

The feature is governed by three non-negotiable principles:

- **Principle A — the template is a blank MOLD, not data.** An uploaded `.xlsx` is last month's actual report full of real numbers. The system uses it only for structure, layout, formatting, fonts, colors, merged cells, column/row sizing, and formulas. On import it produces a "blank master" by setting every daily-input cell to `0` while preserving everything else. Template production numbers must never appear in any export.
- **Principle B — on the import path, inject, never rebuild.** When a Template is uploaded, the system never recreates that uploaded workbook's styles or formulas in code. It loads the workbook with ExcelJS (`load` → set `cell.value` → `writeBuffer`), writing only into an allow-list of cells (daily-input cells, date cells, tab rename, trailing-block deletion). SheetJS (`xlsx`) is never used for writing.
- **Principle C — on the reconstruction path, build once, then inject.** When no Template is uploaded, the system builds the master workbook programmatically in code using ExcelJS, writing real cell styles, named styles, merges, dimensions, number formats, and intra-sheet formulas so that a zero-data export is visually indistinguishable from the original master. After reconstruction the workbook is stored as the Blank_Master and is thereafter treated exactly like an imported Blank_Master: only daily values are ever injected, and the same write allow-list of Principle B applies.

The work is delivered in two stages. **Stage 1 (the new capability):** before building anything, the system reads the existing codebase to discover which DPR input values already exist and where, produces a **Source Map** (DPR field → machine → source → confidence → query), classifies each field as Auto-sourced / Needs-confirmation / Manual, and surfaces open questions for the user to answer first. **Stage 2:** the application itself — Import, Source-Map review, Month Setup, Daily Entry grid, Delay Log, and Save/Export/Start-new-month.

## Glossary

- **DPR_Manager**: The web application defined by this specification (frontend + backend + export engine).
- **Source_Map_Service**: The Stage-1 backend capability that inventories the existing codebase and produces the Source Map and open questions.
- **Import_Service**: The backend capability that ingests an uploaded `.xlsx`, detects its structure, classifies cells, and produces the blank master.
- **Export_Engine**: The backend capability that injects saved day values into the blank master and produces the downloadable monthly workbook using ExcelJS.
- **Reconstruction_Engine**: The backend capability that builds the master workbook programmatically in code with ExcelJS — writing worksheets, named styles, fills, fonts, borders, merges, column widths, row heights, number formats, and intra-sheet formulas — so that a zero-data export is visually indistinguishable from the original master.
- **Reconstructed_Master**: A Blank_Master produced by the Reconstruction_Engine rather than by importing an uploaded Template; once produced it is treated identically to an imported Blank_Master.
- **Named_Style**: A reusable cell-style definition applied during reconstruction, one of `title`, `hdr`, `inputY`, `inputCyan`, `calc`, `tgt`, `silver`, `ot`, or `attn`, each pairing a fill, font, alignment, border, and number format.
- **Color_Legend**: The fixed mapping of semantic roles to resolved RGB hex fill values used during reconstruction (e.g. White `FFFFFF`, Light yellow `FFFF99`, Cyan `00FFFF`, Peach `FFCC99`, Pale cyan `CCFFFF`, Silver `C0C0C0`, Yellow `FFFF00`, Light orange `F4B183`, Gold `FFC000`).
- **Main_Sheet**: The primary DPR worksheet whose tab name follows the form `<MONTHNAME><YY>`, ordered first in the workbook.
- **Delay_Sheet**: The `DELAY` worksheet, ordered second in the workbook, holding repeating shift-blocks of stoppage line entries.
- **Block_Anatomy**: The fixed internal layout of a Day_Block by row offset — title row (offset 0), column-header band (offsets 1–3), machine/area data rows (offsets 4–29), summary/target/scrap/yield band (offsets 30–41), and the MAJOR STOPPAGES note (offset 45).
- **Formula_Catalog**: The complete set of templated, intra-sheet-only formulas written into each Day_Block, including production totals, cumulatives chained to the previous day's block, averages, electrical/mechanical/operational totals, stoppage and utilisation totals, prod rate, scrap/rejection percentages, grand totals, and yield.
- **Verification_Checklist**: The set of post-reconstruction checks confirming tab name, block count and geometry, widths and heights, fills, fonts, merges, formulas, and number formats match the original master.
- **Integration_Layer**: The backend layer of one adapter per data source that resolves auto-sourced field values for a given date, machine, and shift.
- **Daily_Entry_Grid**: The frontend screen where an operator enters or confirms each day's values per machine and shift.
- **Delay_Log**: The frontend screen and `DELAY` sheet data capturing per-shift stoppage rows (time, agency, reason).
- **Template**: An uploaded source `.xlsx` workbook used as the structural mold; stored with its derived blank master.
- **Blank_Master**: The normalized workbook derived from a Template where every daily-input cell holds numeric `0` and all formulas, config, styles, labels, merges, and fonts are preserved.
- **Daily_Input_Cell**: A cell whose value is entered each day (production A/B/C, stoppage minutes, availability, scrap/rejection/trim/b.slit, delay fields). Set to `0` on import.
- **Formula_Cell**: A cell containing an Excel formula; never written by the system.
- **Config_Cell**: A cell holding configuration or target values (column `B` monthly target, column `V` prod-rate target, target-% rows, column `X` day-count divisor seeds); preserved as editable defaults, never zeroed.
- **Day_Block**: The repeating 46-row structure on the main sheet representing one calendar day.
- **Block_Stride**: The fixed row offset (46) between consecutive Day_Blocks on the main sheet.
- **Title_Row**: The anchor row of a Day_Block; `titleRow(1)=2`, `titleRow(N)=49+(N-2)*46`.
- **Machine_Row_Offset**: The per-machine row offset from a Day_Block's Title_Row (e.g. HRS=4, 6 Hi (R)=9).
- **Auto_Sourced_Field**: A DPR field with a clear reliable source in the existing code; pre-filled and flagged "from system".
- **Needs_Confirmation_Field**: A DPR field with a plausible but ambiguous source requiring a user answer before wiring.
- **Manual_Field**: A DPR field with no source in code; entered by the operator, optional, defaulting to `0`.
- **Field_Provenance**: The per-cell record of whether a saved value came from an auto source or manual entry.
- **Month_Identity**: The three places a month's identity appears — main sheet tab name, date strings, export filename.
- **Sequential_Day_Entry**: The rule that day N may be entered only after days 1 through N-1 exist.
- **Zero_Fill_Export**: Export behavior where entered days carry their values and all other days' input cells are `0`.
- **Operator**: The end user who enters daily DPR data and triggers exports.
- **Reviewer**: The user who answers Stage-1 open questions and reviews/edits the Source Map and field mapping.

## Requirements

### Requirement 1: Stage-1 Codebase Discovery and Source Map

**User Story:** As a Reviewer, I want the system to discover which DPR input values already exist in the codebase and present a Source Map before building, so that values are auto-filled rather than re-typed.

#### Acceptance Criteria

1. WHEN a Stage-1 discovery run is requested, THE Source_Map_Service SHALL scan the existing backend source, database schema, API routes, and DPR-related modules to locate a source for each DPR input field.
2. THE Source_Map_Service SHALL produce a Source Map where each entry records the DPR field, the machine, the source reference (table.column, endpoint, or function), a confidence value of `high`, `medium`, or `low`, and a description of how to query the value.
3. THE Source_Map_Service SHALL classify each DPR field as exactly one of `auto-sourced`, `needs-confirmation`, or `manual`.
4. IF a candidate source exists but its mapping, units, date grain, or shift grain is ambiguous, THEN THE Source_Map_Service SHALL classify the field as `needs-confirmation` and record an associated open question.
5. IF no source is found in the codebase for a DPR field, THEN THE Source_Map_Service SHALL classify the field as `manual`.
6. THE Source_Map_Service SHALL output the Source Map and the list of open questions before any Stage-2 application build proceeds.
7. WHEN the Reviewer supplies additional code locations to inspect, THE Source_Map_Service SHALL re-run discovery and update the Source Map.

### Requirement 2: Stage-1 Clarifying Questions

**User Story:** As a Reviewer, I want the system to ask specific clarifying questions where sourcing is uncertain, so that ambiguous mappings are resolved correctly instead of guessed.

#### Acceptance Criteria

1. WHERE a DPR field is classified as `needs-confirmation`, THE Source_Map_Service SHALL present a clarifying question identifying the field, the machine, and the candidate source.
2. WHERE a clarifying question has a known finite set of answers, THE Source_Map_Service SHALL present the question with selectable answer options.
3. WHEN the Reviewer answers a clarifying question, THE Source_Map_Service SHALL update the corresponding Source Map entry and set its status to `confirmed`.
4. IF a sourcing decision affects correctness of an exported value, THEN THE Source_Map_Service SHALL surface that decision as a clarifying question rather than applying a default mapping.
5. THE Source_Map_Service SHALL record each machine-to-identifier mapping, unit conversion, and date-grain or shift-grain decision provided by the Reviewer.

### Requirement 3: Template Import and Structure Detection

**User Story:** As a Reviewer, I want to upload last month's workbook once and have the system detect its structure, so that the blank master matches the real report exactly.

#### Acceptance Criteria

1. WHEN a Reviewer uploads an `.xlsx` Template, THE Import_Service SHALL store the original file blob.
2. WHEN a Template is imported, THE Import_Service SHALL detect the main sheet Block_Stride by scanning the main sheet for the `DATE` marker in column K.
3. WHEN a Template is imported, THE Import_Service SHALL detect machine labels from column A and record each Machine_Row_Offset.
4. WHEN a Template is imported, THE Import_Service SHALL detect the `DELAY` sheet block stride by scanning column A for the `LINE` marker.
5. WHEN a Template is imported, THE Import_Service SHALL classify each cell as a Formula_Cell, a Daily_Input_Cell, or a Config_Cell, and SHALL record the daily-input cell map and the config cell map.
6. IF an uploaded file is not a readable `.xlsx` workbook, THEN THE Import_Service SHALL reject the upload and return a descriptive error.
7. IF a readable `.xlsx` workbook fails structure validation, such as a missing main sheet, missing `DATE` marker, or missing `LINE` marker, THEN THE Import_Service SHALL reject the upload and return a descriptive error identifying the failed check.

### Requirement 4: Blank Master Generation (Principle A)

**User Story:** As a Reviewer, I want every daily-input value zeroed on import while structure is preserved, so that the template's production numbers never leak into exports.

#### Acceptance Criteria

1. WHEN the Import_Service builds a Blank_Master, THE Import_Service SHALL set every Daily_Input_Cell to numeric `0`.
2. WHEN the Import_Service builds a Blank_Master, THE Import_Service SHALL preserve every Formula_Cell, Config_Cell, label, merged-cell range, font, color, column width, and row height from the Template.
3. THE Import_Service SHALL write numeric `0` rather than an empty value to every Daily_Input_Cell.
4. WHEN a Blank_Master is opened in Excel after generation, THE Blank_Master SHALL present layout, colors, fonts, merges, and formulas identical to the Template with only daily-input values cleared.
5. THE Export_Engine SHALL exclude every Template daily-input value from all exported workbooks.

### Requirement 5: Template Injection Export Engine (Principle B)

**User Story:** As an Operator, I want exports built by injecting values into the stored mold using ExcelJS, so that styles and formulas are never lost.

#### Acceptance Criteria

1. WHEN the Export_Engine builds a workbook, THE Export_Engine SHALL load the stored Blank_Master, set cell values, and produce output via the ExcelJS `writeBuffer` operation.
2. THE Export_Engine SHALL restrict all workbook writes to the allow-list of Daily_Input_Cells, date cells, the main sheet tab rename, and trailing-block deletion.
3. THE Export_Engine SHALL NOT write to any Formula_Cell.
4. THE Export_Engine SHALL use ExcelJS for all workbook write operations and SHALL NOT use the SheetJS `xlsx` library for writing.
5. WHEN an export is produced, THE Export_Engine SHALL preserve all styles, fonts, colors, merged cells, and formulas present in the Blank_Master.

### Requirement 6: Auto-Fill Behavior in Daily Entry

**User Story:** As an Operator, I want auto-sourced values pre-filled and flagged, with manual fields optional, so that I only enter what the system cannot already provide.

#### Acceptance Criteria

1. WHEN an Operator opens the Daily_Entry_Grid for a date, THE Integration_Layer SHALL fetch values for each Auto_Sourced_Field for that date, machine, and shift.
2. WHEN an Auto_Sourced_Field value is displayed, THE Daily_Entry_Grid SHALL show the value pre-filled and visually flagged as sourced from the system.
3. WHEN an Operator edits a pre-filled Auto_Sourced_Field, THE Daily_Entry_Grid SHALL accept the override and retain the operator-entered value.
4. WHERE a field is a Manual_Field, THE Daily_Entry_Grid SHALL present the field blank or zero and SHALL treat entry as optional.
5. IF an Operator does not enter a value for a Manual_Field, THEN THE DPR_Manager SHALL store numeric `0` for that field.
6. THE DPR_Manager SHALL record Field_Provenance for each saved value indicating whether the value was auto-sourced or manually entered.
7. THE DPR_Manager SHALL allow saving a day without requiring entries for machines other than those the Operator chooses to fill.

### Requirement 7: Integration Layer and Editable Field Mapping

**User Story:** As a Reviewer, I want a clean integration layer with editable field mappings, so that sources can be changed without touching the export engine.

#### Acceptance Criteria

1. THE Integration_Layer SHALL provide one adapter per data source that resolves field values independently of the Export_Engine.
2. WHEN a data source adapter is added or changed, THE DPR_Manager SHALL apply the change without modifying the Export_Engine.
3. WHERE a field mapping exists, THE DPR_Manager SHALL allow the Reviewer to edit the mapping through the user interface.
4. WHEN a Reviewer edits a field mapping, THE Integration_Layer SHALL resolve subsequent auto-sourced values using the edited mapping.

### Requirement 8: Workbook Structure Model

**User Story:** As a developer, I want the verified workbook geometry encoded, so that values land in the correct cells for every day and machine.

#### Acceptance Criteria

1. THE DPR_Manager SHALL compute the Title_Row for day N as `49 + (N - 2) * 46` for N greater than 1, with the day-1 Title_Row equal to `2`.
2. THE DPR_Manager SHALL compute the absolute row for a machine as `Title_Row(N) + Machine_Row_Offset`.
3. THE DPR_Manager SHALL map production shift A, B, and C to main sheet columns C, D, and E as Daily_Input_Cells.
4. THE DPR_Manager SHALL map electrical stoppage to columns Z/AA/AB, mechanical stoppage to AD/AE/AF, and operational stoppage to AH/AI/AJ as Daily_Input_Cells.
5. THE DPR_Manager SHALL map availability to columns AL/AM/AN, preventive maintenance to AP, power failure to AR/AS/AT, and R/M shortage to BB/BC/BD as Daily_Input_Cells.
6. THE DPR_Manager SHALL map shift-wise scrap, trimm, rejection, and b.slit to columns BI–BL (shift A), BM–BP (shift B), and BQ–BT (shift C) as Daily_Input_Cells.
7. THE DPR_Manager SHALL treat columns F, G, H, the day-count divisor seed in column X, and all summary, target, scrap, and yield formula columns as cells that are never written by the system.
8. THE DPR_Manager SHALL write the day number to column BH on the Title_Row.

### Requirement 9: Delay Log Capture

**User Story:** As an Operator, I want to record per-shift delay entries, so that the DELAY sheet reflects stoppage time, agency, and reason.

#### Acceptance Criteria

1. THE Delay_Log SHALL provide three shift blocks per day on the `DELAY` sheet, with header rows identified by column A equal to `LINE`.
2. THE DPR_Manager SHALL compute the `DELAY` sheet block index as `(dayNumber - 1) * 3 + shiftIndex`.
3. THE Delay_Log SHALL capture machine in column A, shift in column C, time in minutes in column D, agency in column E, and reason in column F as Daily_Input_Cells.
4. WHERE a delay time value is non-numeric, THE DPR_Manager SHALL store the raw string in column D, including values such as `210--160` and `NIL`.
5. THE DPR_Manager SHALL write the date only to the `DELAY` sheet header rows in column B.

### Requirement 10: Month-Awareness and Identity Rewrite

**User Story:** As an Operator, I want the exported workbook to carry the correct month identity, so that the tab, dates, and filename reflect the chosen month.

#### Acceptance Criteria

1. THE DPR_Manager SHALL derive the month and year from the entered dates.
2. WHEN an export is produced, THE Export_Engine SHALL rename the main sheet tab to the form `<MONTHNAME><YY>`, such as `JUNE26`.
3. WHEN an export is produced, THE Export_Engine SHALL write date strings as text in `dd.mm.yyyy` format to the main sheet column M Title_Rows and the `DELAY` sheet column B header rows while preserving the `mm/dd/yy` number format.
4. WHEN an export is produced, THE Export_Engine SHALL name the output file in the form `DPR <Month> <Year>.xlsx`.

### Requirement 11: Variable Month Length

**User Story:** As an Operator, I want exports to contain exactly the right number of day blocks, so that months of 28, 29, 30, or 31 days are represented correctly.

#### Acceptance Criteria

1. THE DPR_Manager SHALL determine the number of days in the selected month, accounting for leap years in February.
2. WHEN an export contains more Day_Blocks than the selected month has days, THE Export_Engine SHALL delete the surplus trailing Day_Blocks from the main sheet from the bottom upward.
3. WHEN an export is trimmed, THE Export_Engine SHALL delete surplus trailing blocks from the `DELAY` sheet from the bottom upward.
4. THE Export_Engine SHALL NOT delete any Day_Block from the middle of a sheet.
5. WHEN an export is produced for a month of D days, THE exported main sheet SHALL contain exactly D Day_Blocks.

### Requirement 12: Sequential Entry and Cumulative Integrity

**User Story:** As an Operator, I want days entered in order with cumulatives chaining correctly, so that running totals are accurate.

#### Acceptance Criteria

1. IF an Operator attempts to enter day N while any day from 1 through N-1 does not yet exist, THEN THE DPR_Manager SHALL block the entry.
2. THE DPR_Manager SHALL store numeric `0` rather than blank in every Daily_Input_Cell so that cumulative formulas referencing the previous day resolve to a number.
3. WHEN a new month is started, THE DPR_Manager SHALL reset cumulatives so that day 1 carries no value from a previous month.
4. THE DPR_Manager SHALL display a day-status indicator marking each day as entered or zero.

### Requirement 13: Zero-Fill Export

**User Story:** As an Operator, I want to export the full month at any time, so that entered days carry values and the rest export as zero with formulas intact.

#### Acceptance Criteria

1. WHEN an Operator requests an export, THE Export_Engine SHALL write each saved day's values, combining auto-sourced and manual values, into the Blank_Master.
2. THE Export_Engine SHALL leave every Daily_Input_Cell of a day that has not been entered set to `0`.
3. WHEN an export is produced, THE Export_Engine SHALL retain all formulas so that derived cells recompute over the injected values.
4. WHEN an export is produced, THE Export_Engine SHALL inject the captured Delay_Log rows into the `DELAY` sheet.

### Requirement 14: Start New Month

**User Story:** As an Operator, I want to start a fresh month without altering the stored mold, so that prior data and the template remain intact.

#### Acceptance Criteria

1. WHEN an Operator starts a new month, THE DPR_Manager SHALL create a new month dataset associated with the existing Template.
2. THE DPR_Manager SHALL preserve the stored Blank_Master unchanged when a new month is started.
3. WHEN a new month dataset is created, THE DPR_Manager SHALL initialize all Daily_Input_Cells for that month to `0`.

### Requirement 15: Data Model and Persistence

**User Story:** As a developer, I want persistent storage for templates, source maps, months, and daily entries, so that work survives across sessions.

#### Acceptance Criteria

1. THE DPR_Manager SHALL persist Template records including the original file blob, the blank master blob, the main sheet code, the block stride, the first Title_Row, the machine row offsets, the input cell map, the config cell map, and the delay block stride.
2. WHERE a Blank_Master is produced by the Reconstruction_Engine rather than by import, THE DPR_Manager SHALL persist the Blank_Master record with the origin marked as `reconstructed` and with the original file blob omitted.
3. THE DPR_Manager SHALL persist Source Map records including the Template reference, the DPR field, the machine, the source reference, the transform, the confidence, and the status.
4. THE DPR_Manager SHALL persist Month records including the Template reference, the month, the year, the sheet code, the days in month, the config overrides, and the status.
5. THE DPR_Manager SHALL persist Daily Entry records including the Month reference, the date, the day number, the values, the delay data, the Field_Provenance, and the status.

### Requirement 16: Month Setup and Config Targets

**User Story:** As a Reviewer, I want to manage config and target values per month, so that target formulas compute without breaking.

#### Acceptance Criteria

1. THE DPR_Manager SHALL present Config_Cell values, including monthly target in column B, prod-rate target in column V, target-percent rows, and the day-count divisor seed in column X, as editable defaults in a Month Setup screen.
2. THE DPR_Manager SHALL NOT set any Config_Cell to `0` during import or export.
3. WHEN a Reviewer edits a config override in Month Setup, THE DPR_Manager SHALL store the override against the Month record and apply it on export.

### Requirement 17: Programmatic Master Reconstruction (Principle C)

**User Story:** As a Reviewer, I want the system to rebuild the master workbook cell-for-cell in code when no template is uploaded, so that I obtain a Blank_Master without supplying last month's file.

#### Acceptance Criteria

1. WHEN a Reviewer requests master reconstruction, THE Reconstruction_Engine SHALL build the workbook programmatically using ExcelJS and SHALL write real cell styles for every populated cell.
2. THE Reconstruction_Engine SHALL create exactly two worksheets in order: the Main_Sheet first and the Delay_Sheet named `DELAY` second.
3. THE Reconstruction_Engine SHALL name the Main_Sheet tab in the form `<MONTHNAME><YY>`, such as `MARCH26`.
4. WHEN reconstruction completes, THE Reconstruction_Engine SHALL store the result as a Blank_Master with every Daily_Input_Cell empty or `0` and all formulas and styles retained.
5. WHEN a Reconstructed_Master is exported with no daily data, THE exported workbook SHALL be visually indistinguishable from the original master with only numeric data cleared.
6. THE DPR_Manager SHALL treat a Reconstructed_Master identically to an imported Blank_Master for all subsequent injection, month-setup, and export operations.
7. THE Reconstruction_Engine SHALL use ExcelJS for all workbook construction and SHALL NOT use the SheetJS `xlsx` library for writing.

### Requirement 18: Reconstruction Visual Fidelity — Geometry and Dimensions

**User Story:** As a Reviewer, I want the reconstructed master to match the original master's geometry exactly, so that every block, row, and column is sized and positioned correctly.

#### Acceptance Criteria

1. THE Reconstruction_Engine SHALL build the Main_Sheet with row 1 as a blank spacer row.
2. THE Reconstruction_Engine SHALL set the Day_Block height to 46 rows and SHALL build exactly 31 Day_Blocks in the Reconstructed_Master.
3. THE Reconstruction_Engine SHALL place the day-1 Title_Row at row 2 and each subsequent Title_Row for day N at `49 + (N - 2) * 46`, and SHALL compute any block cell as `Title_Row(N) + offset`.
4. THE Reconstruction_Engine SHALL set per-offset row heights as 23.2 at offset 0, 15.8 at offset 1, 31.5 at offset 2, 15.8 at offsets 3 through 34, 15.0 at offsets 35 through 36, 15.8 at offsets 37 through 39, and 15.0 at offsets 40 through 45.
5. THE Reconstruction_Engine SHALL set each Main_Sheet column width from column A through column DB to the value specified for that column, defaulting to 10.28 where no specific width is given.
6. THE Reconstruction_Engine SHALL show gridlines and SHALL NOT apply freeze panes on the Main_Sheet.
7. THE Reconstruction_Engine SHALL set Delay_Sheet column widths as A=11.14, B=12.0, D=19.71, E=16.43, F=109.57, and G=72.0, with column C at the default width.

### Requirement 19: Reconstruction Visual Fidelity — Color Legend and Named Styles

**User Story:** As a Reviewer, I want reconstruction to use a fixed semantic color legend and reusable named styles, so that fills and formatting are consistent and match the original master.

#### Acceptance Criteria

1. THE Reconstruction_Engine SHALL apply resolved RGB hex fill values directly from the Color_Legend without relying on workbook theme color indices.
2. THE Reconstruction_Engine SHALL fill headers and unfilled cells White `FFFFFF`, primary daily-input cells Light yellow `FFFF99`, equipment-availability input cells on rolling-machine rows Cyan `00FFFF`, computed and derived band cells Peach `FFCC99`, target column B and SCRAP%/REJ% computed cells Pale cyan `CCFFFF`, scrap/rejection/b.slit shift sub-headers Silver `C0C0C0`, attention cells and the entire Delay_Sheet header row Yellow `FFFF00`, O.T input cells Light orange `F4B183`, and O.T total cells Gold `FFC000`.
3. THE Reconstruction_Engine SHALL define and reuse the Named_Styles `title`, `hdr`, `inputY`, `inputCyan`, `calc`, `tgt`, `silver`, `ot`, and `attn`, each pairing a fill, font, alignment, border, and number format.
4. THE Reconstruction_Engine SHALL apply the Cyan `00FFFF` equipment-availability input fill only on rolling-machine rows.
5. THE Reconstruction_Engine SHALL apply the Book Antiqua font to the Title_Row only, the Arial font to the entire Main_Sheet body, and the Calibri font to Delay_Sheet entries.
6. THE Reconstruction_Engine SHALL center-align cell content except where a region specifies a different alignment, and SHALL apply per-region bold and font sizes between 8 and 18 points as specified for each region.

### Requirement 20: Reconstruction Visual Fidelity — Block Anatomy and Merged Cells

**User Story:** As a Reviewer, I want each reconstructed block to reproduce the original block's regions and merged cells exactly, so that labels, headers, and spanned areas appear correctly.

#### Acceptance Criteria

1. THE Reconstruction_Engine SHALL build each Day_Block with a title row at offset 0, a column-header band at offsets 1 through 3, machine and area data rows at offsets 4 through 29 covering 26 areas with the specified column-A labels including HRS, PKLG, 4 Hi (R), and O.T, a summary/target/scrap/yield band at offsets 30 through 41, and a MAJOR STOPPAGES note at offset 45.
2. THE Reconstruction_Engine SHALL apply the specified fill, bold, and role to each cell of each region per the Block_Anatomy.
3. THE Reconstruction_Engine SHALL create exactly 73 merged-cell ranges per Day_Block, covering the title merges, header-band merges, paired sub-row body merges for the 4 Hi, 6 Hi, and 2 Hi machine groups, and the summary-band merges.
4. THE Reconstruction_Engine SHALL apply the right-block condensed machine grouping in columns BH, BW, and CK.
5. THE Reconstruction_Engine SHALL apply the Delay_Sheet header-row merges and borders as specified.

### Requirement 21: Reconstruction Number Formats

**User Story:** As a Reviewer, I want each reconstructed cell to carry the correct number format, so that values display with the precision used in the original master.

#### Acceptance Criteria

1. THE Reconstruction_Engine SHALL apply the `0.0` number format to production cells.
2. THE Reconstruction_Engine SHALL apply the `0` number format to stoppage integer cells.
3. THE Reconstruction_Engine SHALL apply the `0.00` number format to electrical total, production-rate, and scrap-percent precision cells.
4. THE Reconstruction_Engine SHALL apply the `0.000` number format to shift scrap and rejection input cells, SHIFT header cells, and O.T cells.
5. THE Reconstruction_Engine SHALL apply the `mm/dd/yy` number format to the Main_Sheet date cell in column M while holding the value as the text string `dd.mm.yyyy`.
6. THE Reconstruction_Engine SHALL apply the `General` number format to label cells.
7. THE Reconstruction_Engine SHALL apply the `mm-dd-yy` number format to the Delay_Sheet header date cell in column B while holding the value as text.

### Requirement 22: Reconstruction Formula Catalog (Intra-Sheet Only)

**User Story:** As a developer, I want reconstruction to write a complete catalog of intra-sheet formulas with correct cumulative chaining, so that derived cells recompute and tab renaming never breaks references.

#### Acceptance Criteria

1. THE Reconstruction_Engine SHALL write only intra-sheet formulas and SHALL NOT write any sheet-qualified cell reference.
2. WHEN the Main_Sheet tab is renamed, THE Reconstructed_Master SHALL retain working formulas with no broken references.
3. THE Reconstruction_Engine SHALL write the production total for machine row r as `F = C + D + E`.
4. THE Reconstruction_Engine SHALL write the day-1 cumulative column G as equal to the production total F of the same row, and SHALL write the day-N cumulative for N greater than 1 as the production total F plus the column G value at the same Machine_Row_Offset in the previous Day_Block.
5. THE Reconstruction_Engine SHALL NOT write a previous-day back-reference in any day-1 cumulative cell.
6. THE Reconstruction_Engine SHALL write the average as `H = G / BH`.
7. THE Reconstruction_Engine SHALL write the electrical, mechanical, and operational total formulas, the today and cumulative stoppage formulas, the today and cumulative utilisation formulas using the machine-specific divisor `16 * 24 * 60` for the HPH row and `7 * 24 * 60` for the CRS-5 row, the production-rate formula, the availability, preventive-maintenance, and power-failure cumulative formulas, the block grand total as `BG = SUM(...)`, the today and till-date scrap totals, the scrap-percent and rejection-percent formulas, the W/R change sum formulas, the daily SUM row, and the yield formula.
8. THE Reconstruction_Engine SHALL chain every cumulative formula to the previous day's Day_Block at the same Machine_Row_Offset, with day 1 carrying no back-reference.

### Requirement 23: Reconstruction Verification Checklist

**User Story:** As a Reviewer, I want reconstruction to be verified against a checklist, so that I can confirm the rebuilt master matches the original before relying on it.

#### Acceptance Criteria

1. WHEN reconstruction completes, THE Reconstruction_Engine SHALL verify that the Main_Sheet tab name matches the pattern `<MONTHNAME><YY>`.
2. WHEN reconstruction completes, THE Reconstruction_Engine SHALL verify that the Day_Block count and per-block geometry match the specified block height, Title_Row positions, and offsets.
3. WHEN reconstruction completes, THE Reconstruction_Engine SHALL verify that all column widths and row heights match the specified values.
4. WHEN reconstruction completes, THE Reconstruction_Engine SHALL verify that all cell fills match the Color_Legend and that fonts match the specified per-region fonts.
5. WHEN reconstruction completes, THE Reconstruction_Engine SHALL verify that all 73 merged-cell ranges per block are present.
6. WHEN reconstruction completes, THE Reconstruction_Engine SHALL verify that every formula is intra-sheet and that cumulative chains reference the correct previous Day_Block.
7. WHEN reconstruction completes, THE Reconstruction_Engine SHALL verify that all number formats match the specified formats.
8. IF any Verification_Checklist check fails, THEN THE Reconstruction_Engine SHALL report the failing check and SHALL NOT mark the Reconstructed_Master as verified.

### Requirement 24: Delay Sheet Reconstruction

**User Story:** As a Reviewer, I want the reconstructed DELAY sheet to reproduce the original sheet's repeating shift-block structure, so that delay entries land in correctly formatted rows.

#### Acceptance Criteria

1. THE Reconstruction_Engine SHALL build the Delay_Sheet as a repeating shift-block with header rows where column A equals `LINE`, placed at rows 1, 21, 41, 62, and 83 and continuing at a block stride of approximately 20 rows, producing 3 blocks per day and 93 blocks in the master.
2. THE Reconstruction_Engine SHALL fill each Delay_Sheet header row Yellow `FFFF00`, apply Calibri 12-point bold, apply medium box borders, and label columns A=`LINE`, B=date with the `mm-dd-yy` number format held as text, C=`SHIFT`, D=`TIME IN MIN.`, E=`AGENCY`, and F=`REASON`.
3. WHEN reconstruction completes, THE Reconstruction_Engine SHALL verify the Delay_Sheet header formatting against each individual requirement — Yellow `FFFF00` fill, Calibri 12-point bold font, and medium box borders — rather than a single combined check.
4. THE Reconstruction_Engine SHALL build 19 machine line rows per Delay_Sheet block.
5. THE Reconstruction_Engine SHALL set each Delay_Sheet machine line row with column A as the machine name in Arial 12-point bold, column B blank, column C as the shift letter in Calibri 12-point bold, column D as a time-in-minutes input accepting numeric or string values such as `210--160` and `NIL`, column E as the agency input, and column F as the free-text reason input.
