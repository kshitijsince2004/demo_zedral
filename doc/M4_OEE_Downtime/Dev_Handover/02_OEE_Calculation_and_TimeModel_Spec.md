# M4 · 02 · OEE Calculation & Time Model
**Deep-plan:** §4 · **Build phase:** M4-1→2 · **Standard:** ISO 22400-2

## 1. The three factors (ISO 22400-2 — the platform's ratified definitions, doc 01 §9)
```
Availability = Operating Time ÷ Planned Production Time
Performance  = (Ideal Cycle Time × Total Count) ÷ Operating Time
Quality      = Good Count ÷ Total Count
OEE          = Availability × Performance × Quality
```
All three are computed from `oee.oee_interval` quantities. No definition lives in app code that the shared KPI registry doesn't also hold (M2/M3/UIL must read identically).

## 2. Equipment time model (the denominators)
| Bucket | Definition | Column |
|---|---|---|
| Calendar Time | 24×7 wall clock | `calendar_time_min` |
| **Planned Production Time (PPT)** | scheduled minus planned non-production | `planned_production_min` ← `canon.shift` |
| Operating Time | PPT minus all downtime | `operating_time_min` ← Σ running `state_interval` |
| Net Operating Time | Ideal Cycle × Total Count | derived |
| Valuable Time | Ideal Cycle × Good Count | derived |

**Planned-time convention (config).** `oee_config.planned_time_convention` selects whether planned stops (breaks, PM, no-demand) are **removed from PPT** (`EXCLUDE_FROM_PPT`) or **counted as planned downtime inside Availability** (`INSIDE_AVAILABILITY`). Both are ISO-valid; pick the house default, allow tenant override. The choice must be stamped on every interval so a trend is never silently redefined.

## 3. Variants
```
TEEP        = OEE × Utilisation,  Utilisation = PPT ÷ Calendar Time
Loading     = PPT ÷ Calendar Time
OPE/OAE     = OEE with "ideal" = demonstrated-best rate, not theoretical
```
TEEP exposes unscheduled capacity (the 24×7 view). `oee_config.teep_enabled` toggles default exposure.

## 4. The ideal-cycle problem (make-or-break)
Performance is only as honest as `oee.ideal_cycle`. Keyed **material × work-unit**, versioned, with `source ∈ {NAMEPLATE, DEMONSTRATED_BEST, M3_PLAN_TARGET, MANUAL}` and an `is_calibrated` flag.
- **DEMONSTRATED_BEST** (default): 95th-percentile sustained observed rate over a trailing window (the OPE-pragmatic value) — computed by a batch job, not hand-entered.
- Any interval whose Performance rests on `is_calibrated = false` is flagged by the **Fidelity gate** (spec 09/§11) and shown as *indicative*, never as a confident number.
- Steel: rated speed differs by gauge × width, so the key includes `grade_ref`; a thin-narrow coil and a thick-wide coil are different denominators.

## 5. Roll-up rule (reference SQL)
Compute at the leaf grain, then aggregate by **summing quantities and dividing** (see `oee.v_oee_rollup`):
```sql
SELECT work_unit_ref,
       SUM(operating_time_min) / NULLIF(SUM(planned_production_min),0)            AS availability,
       (SUM(total_count) * MAX(ideal_cycle_time_sec)/60.0)
                                / NULLIF(SUM(operating_time_min),0)               AS performance,
       SUM(good_count) / NULLIF(SUM(total_count),0)                              AS quality
FROM oee.oee_interval
WHERE bucket_start >= :from AND bucket_start < :to
GROUP BY work_unit_ref;
```
**Never** `AVG(oee)`. OEE of a line = recompute from summed child quantities (mixed ideal cycles are handled by summing Net Operating Time, not by averaging Performance).

## 6. Acceptance (MUST)
- C-01 A/P/Q/OEE match a hand-worked ISO 22400 example to 4 dp on a fixture dataset.
- C-02 Rollup over N intervals equals the single-interval OEE computed from summed quantities (no averaging drift).
- C-03 Switching `planned_time_convention` re-derives Availability deterministically and is logged in `policy_change_log`.
- C-04 An uncalibrated ideal cycle marks every dependent OEE as `fidelity != AUTOMATIC` indicative and raises the Fidelity gate.
- C-05 TEEP = OEE × (PPT ÷ Calendar) holds on the fixture.
