# CTL Plan-Sourcing — Implementation Plan

> Addendum for **Cut-to-Length (CTL)** operator screen: field sourcing (PPC plan vs
> prior CRS vs operator) and wiring. Grounded in .kiro/CTL 21.07.2026B.XLSX and
> the RWD pattern in wd-plan-sourcing.md.
>
> Contract: ctlSchema + 	xn.prod_ctl. No new DDL columns in this slice —
> Length/Pcs/Prod. Version live in aw_row_json + prefill; aggregates persist.

---

## 1. Two convergent sources

1. **Journey-driven (primary):** CRS complete with For-CTL → advance to LE →
   GET /stations/ctl/queue.
2. **PPC plan (enrichment):** CTL plan import (rom_work_center = L) into
   planning.ppc_batch + linkBatchToJourney at step LE.

**Queue** = journey. **Prefill** = Plan ▸ Prior (CRS) ▸ Master. **Weight** is the
exception: Prior ▸ Plan ▸ Master (operator then enters Input Weight kg).

---

## 2. Column mapping

Legend: Plan / Prior (CRS) / Master / Operator / Derived

| Log-sheet field | ctlSchema / UI | Plan / prior | Source |
| --- | --- | --- | --- |
| Mother Coil + Slit ID | displayCoilNo | Mother Coil + Slit ID | Plan |
| Coil / Batch | coilNo / batchNumber | Batch Number | Plan |
| Customer | customerName | Customer Name | Plan / Master |
| Nominal Width | widthMm | Width | Plan / Prior |
| Thickness | thkMm | Pre Stage Thickness | Plan / Prior |
| Nominal Length | prefill nominalLengthMm | Length | Plan (display) |
| Length Set | nominalSetLengthMm | — | Operator |
| Actual Length | actualLengthMm | — | Operator |
| Planned Pcs | prefill plannedPcs | Pcs (1500 NO) | Plan (display) |
| Coil weight ref | prefill weightMt | Coil Weight / CRS output_wt_mt | Prior then Plan |
| Input Weight (kg) | weightMt via kgToMt | — | Operator |
| Bundles 1-4 pcs | noPieces / noBundles | No of Rows (hint) | Operator / Derived |
| Bundle weight | UI only (auto or manual) | Bundle Wt. (hint) | Derived / Operator |
| Reject pcs / wt | rejectionMt | — | Operator / Derived |
| Line speed | lowSpeed (m/min as string) | — | Operator |
| Flatness / Squareness | soft-block every 50 pcs | — | Operator (not DDL) |
| Hold | holdMt | — | Operator |
| Remarks | remarks | Remark | Operator |
| Prod. Version | prefill prodVersion (CTL5) | Prod. Version | Plan (line hint) |
| Stoppage / crew | shared sub-forms | — | Operator |

Locked length split: Nominal = plan only; Set → nominal_set_length_mm; Actual → actual_length_mm.

---

## 3. Prefill — resolvePrefill('CTL', coilNo)

Scope plan rows: from_work_center='L' OR machine_code='CTL', match coil_no [+ slit_id] / batch_number.

Extra from raw_row_json: lengthMm, plannedPcs, prodVersion, noOfRows, bundleWtMt, length tols / packing.

---

## 4. Import parser

ctlPlanXlsxParser.ts → same ParsedRollingPlanRow shape with machineCode/subProcess='CTL', fromWorkCenter='L'. Wire sheetType='CTL' in PPCImportService (no CRM mill order — journey only, like RWD).

---

## 5. Machine assignment

Plan Prod. Version (e.g. CTL5) is a line hint only. Full capability matching against a Machine Spec Master is deferred until that sheet arrives.

---

## 6. Locked decisions

- CTL-Q1 — Weight: Prior CRS output preferred; plan fallback; operator Input Weight (kg) is source of truth for weight_mt / total_prod_mt.
- CTL-Q2 — Length: three fields; only Set + Actual persist.
- CTL-Q3 — Bundles: four slots; persist aggregates; auto-distribute weight by piece share (toggle to manual).
- CTL-Q4 — Squareness: every 50 pcs soft-block (OQ-4); readings not DDL.
- CTL-Q5 — Sourcing: both plan import and journey advance.
