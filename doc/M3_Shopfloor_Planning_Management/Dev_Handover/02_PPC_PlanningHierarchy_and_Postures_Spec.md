# M3 · 02 — PPC, Planning Hierarchy & Postures Spec (M3c)
**Deep-plan ref:** §2 (hierarchy), §5 (postures + MRP/MPS engine). **Standards:** APICS/ASCM MPC, MRP II, SAP PP object flow, ISA-95 Part 3.

## 1. The planning hierarchy M3c implements
`Demand → MPS → RCCP → MRP → CRP → (detailed schedule, spec 03)`. Horizons shrink top→bottom (months→days). M3c owns the upper hierarchy **only to the depth the posture demands**; it always computes capacity load (RCCP/CRP) so it can flag an infeasible ingested plan even when it didn't author the plan.

## 2. The three postures (the defining design choice)
A single `ops.planning_config.posture` per tenant selects behaviour. **Same canonical entities, different author.**

| Stage | A · Adherence | B · Own-the-schedule | C · System of record |
|---|---|---|---|
| Demand / forecast | ingest | ingest | **generate** |
| MPS | ingest | ingest | **generate** |
| MRP (explosion, netting) | ingest | ingest | **generate** |
| RCCP / CRP (capacity) | optional | **compute** | **compute** |
| Detailed scheduling (spec 03) | ingest finished | **own** | **own** |
| Dispatch + order lifecycle | **own** | **own** | **own** |
| Execution + handover (spec 04) | **own** | **own** | **own** |
| Adherence KPIs | **own** | **own** | **own** |

Flags set per posture: A → `mrp_enabled=false`, schedule rows ingested with `status='COMMITTED'`. B → `mrp_enabled=false`, scheduler authors schedule. C → `mrp_enabled=true`, MRP engine authors demand/MPS/planned orders.

## 3. MRP/MPS engine (Posture C)
Standard deterministic run, triggered manually or by Airflow:
1. **MPS** — for independent-demand finished items, net `demand_forecast` against on-hand (`material_stock`) + scheduled receipts → `mps_line`.
2. **BOM explosion** — walk `bom_line` top-down; for each level compute **gross requirement** = parent planned qty × `qty_per` × (1 + `scrap_pct`).
3. **Netting** — net against `material_stock.on_hand_qty − allocated_qty` + scheduled receipts.
4. **Lead-time offset** — start = need date − `lead_time_days` → `planned_order.need_date`.
5. **Emit** — `planned_order` rows (`source='MRP_GENERATED'`, `mrp_run_ref` set); make vs buy by `material_type` (FINISHED/WIP→make, RAW/CONSUMABLE→purchase requisition out via spec 07).
6. **CRP** — load resulting planned orders × `routing_operation.run_minutes_per_unit` against `work_center_capacity`; surface overload.

v1 = single- or multi-level explosion (config), **net-change** default with regenerative option (`mrp_run.run_type`). Multi-echelon/optimised MRP is future scope (spec 08).

## 4. RCCP/CRP capacity check (all postures)
`required_minutes(WC, period) = Σ orders (run_minutes_per_unit × qty + setup_minutes)`; `load_pct = required ÷ (available_minutes × efficiency_pct/100)`. `load_pct > 100` → capacity alert (Monitoring) and an infeasibility flag on the ingested/generated plan. This diagnostic is valuable in **every** posture — it is how M3 tells a Posture-A client "your ERP's plan can't physically run on Tuesday."

## 5. Interfaces (see spec 07 for full OpenAPI)
- `POST /ppc/mrp-run` (Posture C) → returns `mrp_run_id`, planned-order count.
- `POST /ppc/mps` — upsert MPS (ingest or generate).
- `GET /ppc/capacity-load?work_center&from&to` → load_pct series.
- `POST /ppc/planned-orders/{id}/firm` → firm a planned order (→ eligible for release, spec 05).

## 6. Acceptance criteria
- **MUST** honour `posture`: in A/B the MRP engine is inert; in C it authors demand/MPS/planned orders.
- **MUST** compute capacity load in all postures and raise an infeasibility flag when `load_pct > 100`.
- **MUST** resolve cost in KPIs via `cost_rate` effective at event date (D7).
- **SHOULD** reconcile MRP gross-to-net arithmetic in a unit test against a worked BOM example.
- **SHOULD** import the **M1 SAP-PP plan CSV** as the first Posture-A/B source (spec 07 mapping).
