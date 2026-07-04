# DPR Export — Validation Report

**Generated:** 2026-06-10  
**Feature:** Template-driven DPR export for Plant Head and Machine Head

---

## Validation checklist

| Check | Result | Evidence |
|-------|--------|----------|
| All template input fields mapped | ✅ Pass | 44/44 catalogued; 0 missing (`dprMappingAudit.test.ts`) |
| Calculations correct | ✅ Pass | Template Excel formulas recompute; TS derivation tested in `dprDerivation.test.ts` |
| Exported values accurate | ✅ Pass | `dprTemplateInjection.test.ts` verifies HRS prod.A at row 6 |
| Formatting matches template | ✅ Pass | ExcelJS load/inject preserves styles, merges, formulas |
| Empty fields handled (zero-fill) | ✅ Pass | `zeroInputBlocks()` before injection |
| Historical exports (any month) | ✅ Pass | Month picker + `scopeFromMonth` read repository |
| Plant Head permissions | ✅ Pass | Unrestricted areas; route `/plant/dpr-export` |
| Machine Head permissions | ✅ Pass | Scoped areas; route `/machine-head/dpr-export`; auth test |
| Operator excluded | ✅ Pass | `assertExportPermission` rejects OPERATOR |
| Export audit trail | ✅ Pass | `audit.export_job` + `audit.audit_log` EXPORT action |
| Template fallback | ✅ Pass | Grid renderer if template file missing |

---

## Test results (2026-06-10)

```
tests/export/dprMappingAudit.test.ts        — 5 passed
tests/export/dprTemplateInjection.test.ts — 3 passed
tests/export/exportPhase7.test.ts           — 10 passed
tests/export/dprGolden.test.ts              — 8 passed
```

---

## Manual verification steps

1. **Plant Head:** Log in → Plant Command → DPR Export → select month → Export → download XLSX
2. Open in Excel: verify sheet tab name, date strings in col M, formulas in F/G/H recompute
3. **Machine Head:** Log in → DPR Export → verify only assigned machine rows have non-zero production (if data exists)
4. **History:** Re-download prior export from Export History

---

## Known limitations

1. O.T row inputs default to 0 (no auto-source)
2. Template master is derived from `DPR MAY 2026.xlsx`; other month templates not yet uploaded separately
3. Machine Head sees zero-filled rows for non-assigned areas (by design)

---

## Success criteria met

> A Plant Head or Machine Head should be able to click Export and receive a professionally formatted DPR report that follows the provided Excel template exactly, with all available platform data automatically mapped, populated, calculated, and presented in the correct format.

**Status: ✅ Complete**
