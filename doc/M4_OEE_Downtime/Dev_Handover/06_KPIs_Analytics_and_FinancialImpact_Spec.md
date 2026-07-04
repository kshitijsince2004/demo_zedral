# M4 · 06 · KPIs, Analytics & Financial Impact
**Deep-plan:** §9, §12 · **Build phase:** M4-2→3

## 1. KPI family (into the shared registry, doc 03)
| KPI | Formula | Source |
|---|---|---|
| OEE | A×P×Q | `oee_interval` |
| Availability | Operating ÷ PPT | `oee_interval` |
| Performance | (Ideal Cycle × Total) ÷ Operating | `oee_interval` |
| Quality | Good ÷ Total | `oee_interval` |
| TEEP | OEE × (PPT ÷ Calendar) | `oee_interval` |
| Utilisation/Loading | PPT ÷ Calendar | `oee_interval` |
| Six-Big-Losses split | minutes/units per loss ÷ total | `loss_attribution` |
| Top-loss Pareto | ranked by minutes & cost | `top_loss` |
| Planned/Unplanned downtime | Σ stop-min by is_planned | `state_interval` |

All definitions live in the **shared ISO 22400 KPI registry** — M4 publishes values, never a private definition. UIL/Reporting/M2/M3 read the same registry.

## 2. The MTBF/MTTR boundary (reliability is M2)
M4 does **not** publish MTBF/MTTR. Those are M2's reliability/maintainability KPIs over the *same* `DowntimeEvent` stream. M4 publishes **time-based Availability** and breakdown-loss minutes; M2 reads those events for failure stats. One downtime truth, two views (deep-plan §12). Reviewers: any MTBF/MTTR in `oee.*` is a defect.

## 3. Financial impact (D7, rate-as-of-event)
| Loss | Priced as | Rate |
|---|---|---|
| Availability (downtime) | lost-min × downtime cost/min | `cost_rate` (downtime) effective at event date |
| Performance (speed/micro-stop) | lost-units × lost-margin/unit | `cost_rate` (throughput) |
| Quality (defect/yield) | scrap+rework units × cost/unit | `cost_rate` (scrap) |
Resolution **always** uses the rate **effective at the event date**, never today's (D7). `loss_attribution.lost_cost` + `cost_rate_ref` persist the provenance.

## 4. Reconciliation (the trust test)
A nightly job asserts, per shift × work-unit:
- `Σ oee.loss_attribution(L1+L2).lost_minutes` = `Σ M2 downtime minutes` for the shared `downtime_event_ref`;
- `oee_interval.total_count` = `Σ M3 ProductionCount.total` for the shift;
- `oee_interval.good_count` = `Σ ProductionCount.good`.
Any drift raises an alert — this is what operationally guarantees "maintenance, production, quality quote one OEE."

## 5. Acceptance (MUST)
- K-01 Registry values for A/P/Q/OEE/TEEP equal `oee_interval` to 4 dp.
- K-02 No MTBF/MTTR is published by M4.
- K-03 Loss pricing uses the event-date `cost_rate`; changing today's rate does not change a historical loss cost.
- K-04 Reconciliation vs M2 (minutes) and M3 (counts) passes on the fixture; drift alerts fire when seeded.
