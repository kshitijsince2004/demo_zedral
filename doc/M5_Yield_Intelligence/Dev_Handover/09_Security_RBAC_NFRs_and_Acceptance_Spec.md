# M5 · 09 · Security, RBAC, NFRs & Acceptance Spec
**Deep-plan:** §13 · **Decisions:** D8 (isolation), D7 (rate-as-of)

## 1. RBAC (extends M1 roles)
| Role | Can |
|---|---|
| **Operator** | live yield tile for own line; confirm scrap reasons & weights |
| **Shift Supervisor** | shift yield, loss bridge; validate reason coding & reconciliation gap |
| **Yield / Process / Metallurgy Engineer** | configure expected-yield factors, reason tree, recoverability, quantity basis; loss & supplier-lot analysis |
| **Cost / Finance analyst** | read priced loss bridge; reconcile yield vs material purchased (read-only) |
| **Plant Manager** | yield trends, € avoidable loss (read-only analytics) |
| **Admin** | masters, integration, capture-fidelity config, yield policy |

Row-level scoping by site/area (RLS on `tenant_id` + scope). Keycloak-issued JWT; scope claims enforced at the API.

## 2. Multi-tenancy & audit
`tenant_id` on every row (D8 logical isolation; physical on request). **Every yield-policy change is audit-logged** with `effective_from` in `policy_change_log` — because expected-yield/basis/tolerance changes move the avoidable-loss number, a yield trend must never be silently re-baselined. Cost rates carry "rate-as-of-event" provenance (D7).

## 3. NFRs
| NFR | Target |
|---|---|
| Live yield tile latency | ≤ 5 s from canonical event (streaming path) |
| Trusted interval availability | ≤ 5 min after window close (batch) |
| Mass-balance close (manual capture) | gap ≤ 2% default; (automatic) ≤ 1% |
| Recompute correctness | deterministic, idempotent, replayable |
| Yield-by-dimension query (ClickHouse) | ≤ 2 s p95 |
| Availability | 99.5% serving; capture offline-tolerant |

## 4. Acceptance criteria (MUST / SHOULD)
**MUST**
- M-01 Mass balance closes: `input == good+scrap+rework+byproduct+ΔWIP+gap`; `gap ≤ tolerance` ⇒ CLOSED.
- M-02 Dual basis: both material yield and FPY/RTY computed and stored where basis allows.
- M-03 **M5 Quality Ratio == M4 OEE Quality factor** on the same ProductionCount/window (±rounding).
- M-04 No double-count: each `loss_attribution` maps to exactly one `production_count_id`.
- M-05 Roll-ups SUM-then-divide for yield/ratios; RTY = ∏FPY (never averaged).
- M-06 Deviation gate: gap > 2× tolerance ⇒ window PROVISIONAL/DEVIATION, gap routed to data-quality, **excluded** from loss bridge.
- M-07 Avoidable loss = actual − PSQ; Pareto defaults to avoidable, by cost.
- M-08 Every loss priced net of salvage/recovery via `cost_rate` (rate-as-of).
- M-09 **MVP bridge gate:** existing yield % == canonical material yield to tolerance on a back-test window AND mass balance ≤1–2%.
- M-10 RLS: a tenant/role cannot read another tenant's / out-of-scope rows.

**SHOULD**
- S-01 Supplier-lot yield spread surfaced.
- S-02 Transition-loss measured and fed back to M3 sequencing.
- S-03 "Other bucket now top loss" prompt fires at top-3 / >10%.
- S-04 Confidence label shown beside every yield number (Fidelity gate).

## 5. Test plan
Unit (formula/edge: zero input, all-scrap, missing genealogy); reconciliation (M5↔M4, M5↔M6, mass-balance — spec 06 §4) in CI; replay/idempotency (recompute twice ⇒ identical); back-test (MVP gate); RLS/security; load (ClickHouse heatmaps). Golden dataset = a Hero Steels shift with known input/good/scrap by COIL_NO.
