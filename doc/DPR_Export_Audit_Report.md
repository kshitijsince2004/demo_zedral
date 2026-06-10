# DPR Export — File Analysis Report

**Generated:** 2026-06-10  
**Sources reviewed:** `Kiro_Build_Prompt.md`, `DPR_Excel_Template_Reconstruction (3).md`, `DPR MAY 2026.xlsx`, existing M1 export module, DPR Manager scaffolding

---

## 1. Markdown specification summary

### Kiro Build Prompt (Principles)

| Principle | Requirement | Implementation status |
|-----------|-------------|----------------------|
| **A — Template is a mold** | Use uploaded Excel only for structure/formatting; discard historical values; zero all daily inputs | ✅ Template copied to `packages/server/assets/dpr/dpr_master_template.xlsx`; injector zeros inputs before writing |
| **B — Template injection** | Load `.xlsx` → write input cells only → save; never rebuild styles/formulas in code | ✅ `DprTemplateInjector` uses ExcelJS `load` → inject → `writeBuffer` |
| **Month-awareness** | Tab name, date strings, filename reflect selected month; trim surplus day blocks | ✅ Month identity + block trim in injector |
| **Zero-fill export** | Unentered days export as numeric 0, never blank | ✅ `zeroInputBlocks()` before injection |
| **Integration layer** | Adapters per source; editable field mapping | ⚠️ M1 `ExportReadRepository` + `DprAggregator` used as live source; DPR Manager adapters remain stubs |

### Excel Template Reconstruction Spec

- **Two sheets:** Main month sheet (`MAY 2026` pattern) + `DELAY`
- **31 day-blocks × 46 rows** on main sheet; title row 2, stride 46
- **26 machine/area rows** per block (HRS through O.T)
- **Input cells (yellow/cyan):** production C–E, stoppage Z–BD, availability AL–AN, scrap BJ/BN/BR, rej BK/BO/BS
- **Formula cells (peach):** totals, cumulatives, utilisation, prod-rate — preserved from template
- **DELAY sheet:** 93 shift-blocks (31×3); columns LINE, date, shift, time, agency, reason

---

## 2. Existing platform capabilities discovered

| Capability | Location | Used for export |
|------------|----------|-----------------|
| Production aggregation | `ExportReadRepository.fetchRuns` + `processMappers` | ✅ Production A/B/C per area/shift |
| Stoppage events | `ExportReadRepository.fetchStoppages` | ✅ Electrical/mechanical/operational/power/R-M |
| Disposition (scrap/rej) | `ExportReadRepository.fetchDisposition` | ✅ Shift scrap and internal rejection |
| Monthly targets | `ExportReadRepository.fetchTargets` | ✅ Column B targets |
| KPI derivation | `derivation.ts` + Excel formulas | ✅ Hybrid: TS pre-calc + template formulas |
| DELAY log builder | `delaySheet.ts` | ✅ Injected into DELAY sheet |
| Export job pipeline | `ExportJobService` / `ExportJobRunner` | ✅ Async jobs + audit trail |
| Role-based access | `exportAuthz.ts` | ✅ Plant Head (all), Machine Head (scoped), Supervisor (line-scoped) |

---

## 3. Requirements coverage

### Plant Head (required)

| Requirement | Status |
|-------------|--------|
| Export plant-level DPR reports | ✅ `/plant/dpr-export` |
| Export production summaries | ✅ Included in DPR workbook rollups |
| Export historical reports | ✅ Month picker + export history |
| All authorized lines/machines | ✅ Unrestricted area scope |

### Machine Head (required)

| Requirement | Status |
|-------------|--------|
| Export machine-specific DPR | ✅ `/machine-head/dpr-export` |
| Assigned machines only | ✅ `getScopedDprAreaCodes` via `machineAccess` |
| Historical machine reports | ✅ Month picker + history |
| Machine performance summaries | ✅ Prod rate/utilisation via template formulas |

---

## 4. Gaps and notes

| Item | Status | Notes |
|------|--------|-------|
| O.T (overtime) inputs | Manual / default 0 | No txn source identified |
| W/R change summary inputs | Partial | Rollups mapped where data exists |
| DPR Manager daily entry UI | Not in scope | Separate module; export uses live txn data |
| Visual golden-file diff | Not automated | Template injection tests verify structure + values |

---

## 5. Architecture (implemented path)

```
Plant Head / Machine Head UI
    → POST /exports { type: 'DPR', scope: { month } }
    → exportAuthz (role + area/machine scope)
    → DprReport.execute
        → ExportReadRepository (live M1 data)
        → DprAggregator (RDM)
        → DprTemplateInjector (Excel template + inject)
    → ExportJobRunner → artifact download
```
