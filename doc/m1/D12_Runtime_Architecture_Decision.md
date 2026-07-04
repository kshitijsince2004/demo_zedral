# Zedral — Architecture Decision Record
### D12 · Runtime Architecture (Monolith vs Microservices)
**Status:** Accepted · **Date:** 2026-06-20 · **Supersedes:** nothing · **Relates to:** D1 (hybrid deploy), D8 (tenant isolation)

---

## Decision

The M2–M7 intelligence modules, the Data Lake, the Unified Intelligence Layer, Operational Monitoring, Reporting and Financial Impact ship as a **modular monolith** — one (or a small number of) deployable units, with each module as a cleanly separated in-process package owning its own schema. **M1 / Manifold connectors remain a separate, edge-deployed concern.** Kafka is the seam between the connector side and the core. Everything stays containerized per D1, but **"containerized" does not mean "microservices."** Microservice extraction is **deferred** and happens only on a load-driven trigger — **M1 connectors first, then M4 (OEE), then others as needed.**

## Context — why this needs deciding

The foundation specs (00, 08) repeatedly say "every service containerized," "service-to-service via mTLS," "golden signals per service." That language **quietly assumes a microservices topology without anyone having decided it.** Left unstated, the team would likely over-split on day one and pay full distributed-systems cost before shipping a single module. D12 makes the choice explicit and sets the trigger for revisiting it.

## Options considered

| Option | What it is | Verdict |
|---|---|---|
| **Pure monolith** | One program, everything intermixed | Rejected — customer-specific M1 logic and module logic would tangle; kills M2–M7 reusability. |
| **Full microservices** | Each module its own independently deployed service | Rejected *for now* — solves multi-team scaling we don't have; heavy operational tax (network failure handling, distributed transactions, 7 pipelines, service discovery) and especially painful on-prem at the factory edge (conflicts with D1). |
| **Modular monolith + separate connector layer** | One core with walled-off in-process modules; M1 connectors separate; Kafka between | **Accepted** — clean boundaries in code, single simple deployable, easy on-prem install, and a clear path to extract later. |

## Rationale (why modular monolith fits *our* constraints)

1. **D1 hybrid / on-prem edge.** Running 7+ microservices with Kafka, mTLS and service discovery *inside a client plant* is an operational burden. One core + the bus is far easier to install, run and support on-site. Microservices make on-prem harder, not easier.
2. **D8 logical tenant isolation** already delivers multi-tenancy at the data-access layer — we do **not** need service separation to isolate customers.
3. **Boundaries already exist in the design.** The "canonical Serving zone only" golden rule, the canonical write-back API, and the one-event module seams (one `DowntimeEvent`, one `ProductionCount`, one `DefectRecord`) are exactly the lines we'd cut along later. A modular monolith enforces them in code today at zero extra runtime cost.
4. **Speed.** M2–M7 functional specs are still in progress. Splitting into services now spends effort on plumbing instead of product.

## Binding constraints for the build team

- M2–M7 are **in-process modules**: separate package + separate schema namespace, **no module reads another module's tables** — only the canonical Serving zone and the write-back API.
- Modules communicate **only** via canonical events / the UIL — never direct module-to-module calls. Disabling one module must not break another.
- A **module registry + per-tenant feature flags** (the existing tenant-config `enabled modules`) controls activation. Same binary, different config — no per-customer code or deploy.
- **M1 / Manifold connectors** are a separate connector framework deployed at the edge; per-client customization lives **only** here, behind a stable connector interface.
- Keep everything **containerized and 12-factor** (D1) so extraction stays a config/packaging change, not a rewrite.

## Extraction triggers (when to revisit)

Extract a module into its own service **only** when one of these is observed — not pre-emptively:

- Sustained resource contention where one module starves others in the shared core, **or**
- Independent scaling need (throughput/latency) that the shared deploy can't meet, **or**
- A team-ownership / release-cadence split that the monolith blocks.

**Expected order:** **M1 connectors** (per-client load, already at the edge) → **M4 OEE** (highest data volume) → others case-by-case. The pre-drawn canonical seams are the cut-lines.

## Consequences

- ✅ Faster to build and ship; far simpler on-prem footprint; clean boundaries preserved.
- ✅ Reversible — extraction is incremental along known seams, never a big-bang rewrite.
- ⚠️ Requires **discipline**: the "canonical-only reads, no cross-module tables" rule must be enforced in code review and tests, or the monolith degrades toward Option A.
- ⚠️ Spec 08 wording ("per-service" mTLS / golden signals) should be read as "per *module/component*" until extraction; update where it implies mandatory service separation.
