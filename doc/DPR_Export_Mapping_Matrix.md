# DPR Export — Mapping Verification Report

**Generated:** 2026-06-10  
**Catalog source:** `packages/server/src/export/dpr/dprFieldCatalog.ts`

---

## Summary

| Category | Count |
|----------|------:|
| Total fields catalogued | 44 |
| Mapped (auto-sourced) | 37 |
| Calculated (Excel formulas) | 6 |
| Manual (default 0) | 1 |
| Missing | 0 |

---

## Field-by-field verification

| Field | Region | Cols | Source | Status | Confidence |
|-------|--------|------|--------|--------|------------|
| prod_shift_a | main | C | txn.shift_log + process tables → DprAggregator.prod.A | mapped | high |
| prod_shift_b | main | D | txn.shift_log + process tables → DprAggregator.prod.B | mapped | high |
| prod_shift_c | main | E | txn.shift_log + process tables → DprAggregator.prod.C | mapped | high |
| prod_total | main | F | Excel formula =C+D+E | calculated | high |
| prod_cum | main | G | Excel formula chains previous day | calculated | high |
| prod_avg | main | H | Excel formula =G/BH | calculated | high |
| monthly_target | main | B | planning.monthly_target → fetchTargets | mapped | high |
| stoppage_elect_a/b/c | main | Z/AA/AB | txn.stoppage_event (ELECTRICAL) | mapped | high |
| stoppage_mech_a/b/c | main | AD/AE/AF | txn.stoppage_event (MECHANICAL) | mapped | high |
| stoppage_oper_a/b/c | main | AH/AI/AJ | txn.stoppage_event (OPERATIONAL) | mapped | high |
| equip_avail_a/b/c | main | AL/AM/AN | txn.stoppage_event (EQUIPMENT_AVAILABILITY) | mapped | medium |
| prev_maint | main | AP | txn.stoppage_event (PREV_MAINT) | mapped | medium |
| power_fail_a/b/c | main | AR/AS/AT | txn.stoppage_event (POWER_FAILURE) | mapped | high |
| rm_shortage_a/b/c | main | BB/BC/BD | txn.stoppage_event (RM_SHORTAGE) | mapped | medium |
| scrap_shift_a/b/c | main | BJ/BN/BR | txn.disposition_log (SCRAP) | mapped | high |
| internal_rej_a/b/c | main | BK/BO/BS | txn.disposition_log (REJ) | mapped | high |
| utilisation_tdy/cum | main | O/P | Excel formula | calculated | high |
| prod_rate | main | Q–V | Excel formula | calculated | high |
| despatch_mt | summary | F (WIP row) | DprAggregator rollups | mapped | medium |
| overtime | summary | B–E (O.T row) | No platform source | manual | low |
| wr_change_4hi/6hi/2hi | summary | K–P rows | DprAggregator rollups.wrChange | mapped | medium |
| delay_time/agency/reason | DELAY | D/E/F | txn.stoppage_event → buildDelayLog | mapped | high |
| day_date | title | M | Generated from scope.month + dayIndex | mapped | high |
| day_number | title | BH | dayIndex | mapped | high |

---

## Machine Head area mapping

| Machine code | DPR area codes exported |
|--------------|-------------------------|
| 4HI | 4HI_R, 4HI_RR, 4HI_SP |
| 6HI / CRM | 6HI_R, 6HI_RR, 6HI_SP, 2HI_SP, 2HI_RW |
| 2HI | 2HI_SP, 2HI_RW |
| HRS | HRS |
| PKL | PKLG |
| ANN | HPH |
| RWD | RW_LINE |
| CRS | CRS_1 … CRS_6 |
| CTL | CTL_1 … CTL_5 |

Non-assigned areas remain at 0 in exported workbook.

---

## Manual fields

- **overtime** (O.T row, cols B–E): No transactional source; exports as 0 unless DPR Manager daily entry is used in future.
