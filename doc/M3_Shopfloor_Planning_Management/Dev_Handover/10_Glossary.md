# M3 · 10 — Glossary (Planning & Control)

**APS (Advanced Planning & Scheduling)** — finite-capacity planning/scheduling that considers all constraints (machine, labour, tooling, material) simultaneously to produce an executable schedule; contrast MRP (infinite capacity).

**Attainment (schedule / quantity)** — degree to which production matched the plan: schedule attainment = completed-on-schedule ÷ scheduled; quantity attainment = actual good ÷ planned.

**BOM (Bill of Materials)** — component structure of a material; exploded by MRP to derive component requirements.

**Campaign (rolling)** — a medium/long sequence of coils run together to minimise setups; steel campaigns sequence **wide→narrow** by width (and smoothly by gauge/hardness) to protect work rolls.

**Capacity (RCCP / CRP)** — Rough-Cut Capacity Planning validates the MPS against key resources; Capacity Requirements Planning checks detailed load at each work centre.

**CRP / RCCP** — see Capacity.

**Confirmation** — the execution actual booked against an order/operation (good/scrap/setup/run); books one canonical ProductionCount.

**Dispatching (ISA-95)** — releasing & assigning scheduled work to the floor (the dispatch list).

**Finite vs infinite capacity** — finite scheduling respects real resource limits; MRP assumes infinite capacity and emits planned orders, not executable schedules.

**Handover (shift)** — structured transfer of state between outgoing and incoming shifts; here, the no-orphan carryover + plan-vs-actual feedback that keeps the plan running 24×7.

**Heijunka** — Lean production levelling; smoothing volume/mix to stabilise flow (a sequencing input).

**ISA-95 / IEC 62264 Part 3** — standard for Level-3 Manufacturing Operations Management activities: detailed scheduling, dispatching, execution, data collection, tracking, performance analysis (+ resource & definition management).

**MPS (Master Production Schedule)** — quantities & due dates for independent-demand end items; the source of demand for MRP.

**MRP / MRP II** — Material Requirements Planning explodes the BOM, nets against stock, offsets by lead time → planned orders; MRP II adds capacity, finance, etc.

**OTIF (On-Time-In-Full)** — orders delivered both on time and complete ÷ total orders.

**Posture (planning)** — Zedral's per-client planning depth: **A** adherence (ingest finished schedule, own execution), **B** own-the-schedule (ingest demand/MPS/MRP, own detailed scheduling), **C** system of record (own the whole hierarchy). Same model, different author.

**Planned order** — MRP's make/buy recommendation before release; firms then releases to a production order.

**Production order** — an authorised, released, costed job to make a quantity of a material by a date; the lifecycle spine. Its `order_id` is carried by `canon.event.order_ref`.

**ProductionCount** — canonical Event-Spine fact (good/scrap/rework qty); recorded once; M3 contextualises (attainment), M4 aggregates (OEE).

**Routing** — ordered operations (per work centre) to make a material; instantiated per order as production operations.

**S&OP** — Sales & Operations Planning; aggregate family-level plan above MPS (usually ERP/Level-4; out of M3 v1).

**Sequence-dependent setup** — changeover time/cost that depends on the order of jobs (captured in the setup matrix); the thing the optimiser minimises.

**Setup matrix** — table of transition costs `from_state → to_state` per work centre; encodes campaign rules (steel width bands, roll changes).

**Throughput / WIP / cycle time** — flow metrics: output per time; work in progress; release→completion elapsed.

**What-if** — candidate schedule under a `scenario_tag`, compared on KPIs before commit.
