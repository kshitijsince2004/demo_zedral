# M4 · 10 · Glossary
**OEE & loss terms used across the M4 handover.**

- **OEE** — Overall Equipment Effectiveness = Availability × Performance × Quality (ISO 22400-2). % of Planned Production Time spent making good product at full speed.
- **Availability** — Operating Time ÷ Planned Production Time. Loses breakdowns (L1) + setup (L2).
- **Performance** — (Ideal Cycle Time × Total Count) ÷ Operating Time. Loses minor stops (L3) + reduced speed (L4).
- **Quality** — Good Count ÷ Total Count. Loses defects (L5) + startup/yield (L6).
- **Planned Production Time (PPT)** — scheduled time minus planned non-production; the OEE denominator; defined once by `canon.shift`.
- **Operating Time** — PPT minus all downtime (the running time).
- **Calendar Time** — 24×7 wall clock; the TEEP denominator.
- **TEEP** — Total Effective Equipment Performance = OEE × Utilisation (PPT ÷ Calendar). Exposes unscheduled capacity.
- **OPE / OAE** — OEE variants where "ideal" is a demonstrated-best rate rather than theoretical nameplate.
- **Six Big Losses** — L1 Breakdown, L2 Setup & adjustment, L3 Idling & minor stops, L4 Reduced speed, L5 Process defects, L6 Startup/yield (Nakajima/TPM).
- **Loss tree** — top-down decomposition of the OEE gap into the Six Big Losses by reason; M4's actual product.
- **Ideal Cycle Time / Rated Speed** — the theoretical fastest time per unit (or rate); the Performance denominator; keyed material × work-unit, versioned.
- **Micro-stop / minor stop** — a stop below the micro-stop threshold (60–120 s); a Performance loss (L3), not Availability.
- **Micro-stop threshold** — the configurable seam between Availability (above) and Performance (below); the most under-measured boundary in OEE.
- **Debounce** — collapsing signal flapping so a single real stop is not logged as many.
- **State model** — controlled vocabulary of machine states, each with `is_planned` and `counts_as` (OEE component).
- **State interval** — a closed, debounced span of one state; the time base for Availability.
- **Capture fidelity** — MANUAL (M1 operator), HISTORIAN (ingested), or AUTOMATIC (PLC/OPC-UA); drives the confidence shown beside OEE.
- **Reason code** — operator-selected cause of a stop; 3-layer tree (category → subsystem → root cause); carries loss category + OEE component.
- **"All Other" bucket** — the single unclassified reason; governed so it never hides a top loss.
- **Top-loss Pareto** — ranked losses by minutes **and** by cost (often different events).
- **DowntimeEvent / StateEvent / ProductionCount** — canonical Event-Spine rows M4 aggregates; **shared** with M2 (failure), M3 (attainment), M5/M6 (yield/quality) — recorded once, never double-counted.
- **MTBF / MTTR** — mean time between failures / mean time to repair; **M2's** reliability KPIs on the same downtime stream — *not* published by M4.
- **Fidelity gate / History gate** — readiness sub-gates: is capture trustworthy enough to show a confident OEE; is there enough labelled loss history to train prediction.
- **Planned-time convention** — whether planned stops leave PPT or sit inside Availability; a per-tenant ISO-valid modelling choice.
