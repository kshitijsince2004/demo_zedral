# Per-Line Import Sheets — Implementation Plan (v2, grounded in real files)

**Date:** 2026-08-03
**Lines in scope:** HRS · PKL · ANN · RWD
**Decisions:** (1) each line has its **own** plan sheet; (2) columns **differ per line**; (3) each line's import must **reject** the wrong file.
**Verified against real files:** `hrs 21.07.2026 B.XLSX`, `PICKLING 21.07.2026 B.XLSX`, `ANNE 21.07.2026.XLSX`.

> **v2 change:** v1 assumed one workbook with line-named tabs. The real files proved otherwise — **each line is a separate file whose only tab is generically named `Sheet1`.** So the line is decided by **import scope (which page you upload to)**, not by tab name, and "reject the wrong file" is enforced by **required/signature columns**, not tab name.

---

## 0. What the real files told us (test results)

Each file has a single tab `Sheet1`, header in row 1. Running them through the current importer:

| File | Current result | Why |
|---|---|---|
| **HRS** | Imports **but loses the route** | Route is under **"Act. Process Route"**, not "Process Route" ⇒ `processRouteRaw` empty ⇒ **journey never links**. Also "Pre Stage **Thinkness**" (typo) ⇒ input thickness unmapped. |
| **PKL** | **Rejected** (if scoped to Pickling) | Tab `Sheet1` doesn't match the "pickling" name rule and Pickling has no fallback ⇒ "no sheet". On Rolling instead: drops pickling fields + misses required `finishThkMm` it doesn't have. |
| **ANN** | Imports **but loses all annealing data** | `Sheet1` falls into the Rolling parser, which knows none of the annealing columns; required `finishThkMm` missing (annealing has none). |

**Cross-file quirks that must be handled:**
- **Route column name differs:** HRS `Act. Process Route` vs PKL/ANN `Process Route` (there's also a separate shorter `Processed Route` — do **not** use it).
- **HRS typo:** `Pre Stage Thinkness` (must be aliased).
- **ANN width is in `Height`:** ANN `Height`=473 is the coil width; ANN `Width`=`143.000*02+175.000*01` is a **slit-combination string** (not a number) → must **not** map to `widthMm`.
- **No finish thickness on PKL/ANN:** pickling/annealing don't change gauge → target thickness = **pre-stage thickness**; `finishThkMm` must **not** be required for these lines.
- **Dates are Excel serials** (46217 …) → existing `excelDateToIso` handles this.
- **Distinct line signatures** (used for reject): HRS→`Finish Thickness` + `HRS Combination`; PKL→`First ANL TMP` (+ PV-Desc `PICKL`); ANN→`Ann Cycle` / `Charge No` / `First Annealing Temp`.

---

## 1. Target architecture (corrected)

- **Scope picks the parser.** The line-scoped import endpoint already carries `line=HRS|PKL|RWD|ANN`; use it to select the parser and read the single sheet (`Sheet1`). Ignore tab name for line resolution.
- **One parser per line, own column map.** `parseHrsPlanXlsx`, `parsePklPlanXlsx`, `parseAnnPlanXlsx` (new), `parseRewindingPlanXlsx` (exists). Model on the RWD parser; all emit the shared `ParsedRollingPlanRow`.
- **Reject the wrong file by content.** Each parser validates (a) its **required** columns and (b) at least one **signature** column; if the signature is absent (e.g., an ANN file uploaded to HRS), return a clear `headerError` and import nothing.
- **Line-specific extras → `raw_row_json`.** Columns without a first-class field (annealing recipe, slitting combos, RM dims) are preserved in `raw_row_json` exactly like the CTL parser already does, so nothing is lost.
- **CRM "Rolling" import untouched** (6HI/4HI/2HI plant-wide).

---

## 2. Column maps (the spec — source header → canonical field)

Common normalization: lowercase, collapse spaces. `req` = required; blank target = store in `raw_row_json`. `machineCode`/`subProcess` are set from scope, not the sheet.

### 2.1 HRS  (`parseHrsPlanXlsx`) — signature: `Finish Thickness` + `HRS Combination`
| Source header | Field | Notes |
|---|---|---|
| Batch Number | `batchNumber` | req |
| Plan Date | `planDate` | req (serial) |
| Shift | `shiftCode` | |
| Mother Coil | `coilNo` | req |
| Slit ID | `slitId` | |
| Customer Name | `customerName` | req |
| Grade | `gradeCode` | req |
| Width | `widthMm` | req (slit width, 536) |
| Finish Thickness | `finishThkMm` | req |
| **Pre Stage Thinkness** | `inputThkMm` | req — **typo alias** |
| Coil Weight | `ppcWeightMt` | req (slit-coil wt) |
| Count | `coilCount` | |
| **Act. Process Route** | `processRouteRaw` | req — **HRS alias** |
| From Work Center / To Work Center | `fromWorkCenter` / `toWorkCenter` | |
| Fin. Surface | `rollFinish` | e.g. MATT |
| Max Thick Tol(mm) / MIN Thick Tol(mm) | `maxThkTolMm` / `minThkTolMm` | |
| Remark / PPC Remarks | `importRemark` / `ppcRemarks` | |
| RM Width, RM Thickness, M. Coil Weight, HRS Combination, CRS Combination, MAX/MIN Width Tol(mm), Ageing, PV-Desc, Material Code/Type, Prod. Version, Priority, Coil size(W/T) | → `raw_row_json` | slitting/RM context |

### 2.2 PKL  (`parsePklPlanXlsx`) — signature: `First ANL TMP` (or PV-Desc `PICKL`) ; **no** `finishThkMm`
| Source header | Field | Notes |
|---|---|---|
| Batch Number | `batchNumber` | req |
| Plan Date | `planDate` | req |
| Shift | `shiftCode` | |
| Mother Coil | `coilNo` | req |
| Slit ID | `slitId` | |
| Customer Name | `customerName` | req |
| Grade | `gradeCode` | req |
| Width | `widthMm` | req (400) |
| Pre Stage Thickness | `inputThkMm` | req ; also `ppcThkMm := inputThkMm` (no gauge change) |
| Coil Weight | `ppcWeightMt` | req |
| Count | `coilCount` | |
| Process Route | `processRouteRaw` | req |
| From Work Center / To Work Center | `fromWorkCenter` / `toWorkCenter` | |
| Surface | `rollFinish` | e.g. HR-BLACK |
| Sale Order / Item No | `sapOrderNo` / `itemNo` | |
| Remark / PPC Remarks | `importRemark` / `ppcRemarks` | |
| First ANL TMP, First SOAK TIME, Delivery Date, Stage Ageing, Ageing, PV-Desc, Material Code/Type, Prod. Version, Priority, Coil size(W/T) | → `raw_row_json` | pickling/next-stage context |

### 2.3 ANN  (`parseAnnPlanXlsx`) — signature: `Ann Cycle` / `Charge No` / `First Annealing Temp` ; **no** `finishThkMm`
| Source header | Field | Notes |
|---|---|---|
| Batch Number | `batchNumber` | req |
| Plan Date | `planDate` | req |
| Shift | `shiftCode` | |
| Mother Coil | `coilNo` | req |
| Slit ID | `slitId` | |
| Customer Name | `customerName` | req |
| Grade | `gradeCode` | req (RM Grade → `raw_row_json`) |
| **Height** | `widthMm` | req — **ANN quirk: width is in Height (473)** |
| Pre Stage Thickness | `inputThkMm` | req ; `ppcThkMm := inputThkMm` |
| Coil Weight | `ppcWeightMt` | req |
| Count | `coilCount` | |
| Process Route | `processRouteRaw` | req |
| From Work Center / To Work Center | `fromWorkCenter` / `toWorkCenter` | |
| Sale Order / Item No | `sapOrderNo` / `itemNo` | |
| Charge No | `chargeNo` | → `raw_row_json` (feeds `ann_charge` later) |
| Remark / PPC Remarks | `importRemark` / `ppcRemarks` | |
| **Width** (slit combo string) | `slitCombination` | → `raw_row_json` — **not** `widthMm` |
| Ann Cycle, Ann Cycle No.1–4, First/Second/Third/Fourth Annealing Temp, all Soaking/Furnace times & temps, Rapid/Water Cool, Charge Unload, Heat Rate 1×4, First Ann No., Annealing Batch, PV-Desc, Material Code/Type, Prod. Version | → `raw_row_json` | full annealing recipe |

**RWD** — unchanged (`parseRewindingPlanXlsx`).

---

## 3. Implementation steps

1. **Server — sheet types + parsers.** Add `'HRS'`/`'PKL'` to `PpcXlsxSheetType` (keep `PICKLING` as alias of `PKL`). Create `hrsPlanXlsxParser.ts`, `pklPlanXlsxParser.ts`, `annPlanXlsxParser.ts` from §2, modeled on `rewindingPlanXlsxParser.ts`. Each: read `Sheet1` (first sheet), find header row, map per §2, push extras to `raw_row_json`, validate `required` + `signature`, return `{rows, headerError, sheetName}`.
2. **Server — required vs finish.** For PKL/ANN drop `finishThkMm` from required and set `ppcThkMm := inputThkMm`. HRS keeps `finishThkMm`.
3. **Server — scope-driven dispatch.** In `previewRollingXlsx` and the commit path, when `lineScope` is set, choose the parser by scope (`HRS→parseHrs`, `PKL→parsePkl`, `ANN→parseAnn`, `RWD→parseRewinding`) and **do not** rely on tab name. `LINE_IMPORT_SCOPE.defaultSheet` = the line's own type.
4. **Server — reject wrong file.** Missing signature column ⇒ `headerError: "This doesn't look like a <LINE> plan (missing <signature>)"`; import nothing (satisfies decision 3 without tab names).
5. **Client — lock + labels.** `LineMhImportPage` `lockedSheetType`: HRS→`'HRS'`, PKL→`'PKL'` (ANN/RWD already right). Panel copy names the line + shows `headerError`/missing-column list.
6. **Tests.** Use these three real files as fixtures: HRS parses with a non-empty `processRouteRaw`; PKL parses (no finish-thickness error); ANN parses with `widthMm=473` from Height; each file uploaded under the **wrong** scope is rejected by signature.

---

## 4. Files touched
`packages/server/src/utils/rollingPlanXlsxParser.ts` (types/aliases) · new `hrsPlanXlsxParser.ts` · new `pklPlanXlsxParser.ts` · new `annPlanXlsxParser.ts` · `packages/server/src/services/PPCImportService.ts` (scope-driven dispatch + `LINE_IMPORT_SCOPE`) · `packages/client/src/pages/machinehead/LineMhImportPage.tsx` · `packages/client/src/components/admin/PpcRollingImportPanel.tsx` · new `packages/server/tests/perLineSheets.test.ts`.

---

## 5. Sequencing & effort
| Step | Item | Est |
|---|---|:--:|
| S1 | HRS + PKL + ANN parsers per §2 | 1.5d |
| S2 | Required/finish-thickness rules + `ppcThk:=inputThk` | 0.25d |
| S3 | Scope-driven dispatch + `LINE_IMPORT_SCOPE` | 0.5d |
| S4 | Reject-by-signature | 0.25d |
| S5 | Client lock + labels/errors | 0.25d |
| S6 | Tests with the 3 real files | 0.75d |

**≈ 3.5 days.** Column maps are already specified (§2), so S1 is now mechanical.

---

## 6. Risk
Contained to the per-line parsers + scope dispatch. CRM "Rolling" import and RWD/CTL parsers unchanged. Extras preserved in `raw_row_json`, so no data is silently lost even before first-class fields exist. Fail-safe: unknown/short file ⇒ reject, never partial-import.

## 7. Relationship to the other plan
Orthogonal to `ZEDRAL_IMPORT_GAPS_REMEDIATION_PLAN_2026-08-03.md` (dedup/safety/visibility). This one fixes **parsing per line**; that one fixes **what happens after parsing**. Recommended order: land the safety fix, then these parsers (both edit `PPCImportService` dispatch/scope).

## 8. Definition of done
HRS/PKL/ANN each import from their own file with the §2 columns; HRS keeps its route (journey links); PKL/ANN no longer error on missing finish thickness; ANN width reads from Height; each file uploaded to the wrong line is rejected; the three real files pass as test fixtures; CRM Rolling import unchanged.
