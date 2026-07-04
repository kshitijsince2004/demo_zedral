# Zedral — Modular Monolith Build Guide
### Companion to D12 · Runtime Architecture · Developer Handover
**Audience:** engineering team · **Status:** v1 for build · **Date:** 2026-06-20 · **Reads-with:** `D12_Runtime_Architecture_Decision.md`, `00_INDEX_and_Architecture.md`, `02_CanonicalDataModel_Spec.md`, `03_Manifold_Spec.md`, `08_Platform_Security_Spec.md`

> **What this document is.** D12 decided *what* we are building (a modular monolith with a deferred path to services). This document is *how* to build it so that "modular" is real and "extract later" is cheap. It has two halves: **Part A — the playbook** (the mental model and the rules, read once by everyone) and **Part B — the implementation blueprint** (concrete package layout, contracts, enforcement, config, and the extraction procedure). Part C is a troubleshooting guide for the problems teams hit when doing this.

---

# Part A — The Playbook (read this first)

## A1. The one rule everything hangs on

> **A module may read only the canonical Serving zone and write only through the canonical write-back API. It may never touch another module's database, import another module's code, or call another module in-process. Modules talk to each other only through canonical data and events.**

If every engineer holds that one rule, the monolith stays modular and any module can later be lifted into its own service without a rewrite. If that rule is broken even a little, we slide back into a tangled monolith (Option A from D12) and extraction becomes a rewrite. Everything below exists to make this rule easy to follow and hard to break.

## A2. The mental model

Picture **one house with walled rooms** (D12's analogy made concrete):

- **The house = one deployable core.** M2–M7, the Data Lake serving layer, the Unified Intelligence Layer, Monitoring, Reporting and Financial Impact all run in one process (or a small few). One install, one config, simple on-prem footprint.
- **Each room = a module.** It has its own four walls (its own Python package and its own database schema). Its door is a tiny published interface. Nobody climbs through another room's window (reads its tables) or knocks a hole in the wall (imports its code).
- **The corridor = the canonical layer + event bus.** Rooms pass things to each other only through the corridor — never directly. The corridor (canonical Serving zone + Kafka events + write-back API) is the *only* shared space.
- **The front door = M1 / Manifold connectors.** This is a *separate building* at the factory edge. It is the only place per-client customization lives. It hands clean canonical data to the house through the corridor.

## A3. The golden rules (pin these up)

1. **Canonical-only reads.** Modules read the canonical Serving zone. Never a source system, never another module's schema.
2. **Write-back only.** Modules persist derived intelligence through the canonical write-back API, not by writing into shared tables.
3. **No module-to-module imports or calls.** Enforced in CI. If module B needs something from module A, it consumes a canonical event or a canonical field — not A.
4. **Each module owns its schema.** One module = one Postgres schema = one migration history. No shared business tables.
5. **Client-specific logic lives only in connectors (M1).** If you're tempted to put an "if client == X" in a module, it belongs in a connector instead.
6. **Same binary, different config.** Modules turn on/off via tenant config + feature flags. Never fork code or build a special deploy per customer.
7. **Design for idempotent, replayable events.** No distributed transactions. Consumers must tolerate at-least-once delivery.
8. **Don't extract early.** Build everything in-core. Split a module into its own service only when an extraction trigger (A4) actually fires.

## A4. When (not) to split a module out

Extract a module to its own service **only** when one of these is observed in production — never pre-emptively:

- One module's resource use is starving the others in the shared core, **or**
- A module needs to scale (throughput/latency) independently in a way the shared deploy can't meet, **or**
- Team ownership / release cadence genuinely needs to diverge and the monolith is the blocker.

**Expected order when it happens:** **M1 connectors** (per-client load, already at the edge) → **M4 OEE** (highest data volume) → others case-by-case. Part B6 is the step-by-step. Because the boundaries above are enforced from day one, extraction is a packaging-and-routing change, not a rewrite.

---

# Part B — Implementation Blueprint

Stack assumed (from `00_INDEX` §4): **Python 3.11 + FastAPI**, **PostgreSQL 15** (+ TimescaleDB / ClickHouse for serving marts), **Kafka** (Redpanda on edge), **Alembic** migrations, **Keycloak OIDC**, **Docker + Kubernetes**. Substitute equivalents only if interfaces and NFRs are preserved.

## B1. Repository & package layout

A single monorepo, one virtual environment, clear top-level separation between the **shared kernel**, the **modules**, and the **separately-deployed connectors**.

```
zedral/
├── pyproject.toml                # one project; modules are sub-packages
├── importlinter.ini              # boundary rules (CI-enforced) — see B5
│
├── platform/                     # SHARED KERNEL — the corridor. Stable, small.
│   ├── canonical/                #   read-models + client for the canonical Serving zone
│   ├── eventbus/                 #   Kafka producer/consumer wrappers + event envelope
│   ├── writeback/                #   canonical write-back API client
│   ├── tenant/                   #   tenant context, config object, feature-flag resolver
│   ├── registry/                 #   module discovery + ModuleManifest contract
│   ├── api/                      #   gateway scaffolding, OIDC auth, error model, pagination
│   ├── db/                       #   engine/session factory, per-schema session guard
│   └── observability/            #   OpenTelemetry, structured logging, metrics
│
├── modules/                      # THE ROOMS. One package per module. No cross-imports.
│   ├── m2_maintenance/           #   schema: maint
│   ├── m3_planning/              #   schema: plan
│   ├── m4_oee/                   #   schema: oee
│   ├── m5_yield/                 #   schema: yield_
│   ├── m6_quality/               #   schema: qual
│   └── m7_energy/                #   schema: energy
│
├── connectors/                   # M1 / MANIFOLD — SEPARATE deployable (own image)
│   ├── framework/                #   connector SDK / stable interface
│   └── plugins/                  #   one per client: hero_steels/, client_x/ ...
│
├── app/
│   └── main.py                   # composition root: builds the app from ENABLED modules
│
└── tests/
    ├── architecture/             # import-linter + boundary tests (B5)
    └── contracts/                # cross-module canonical contract tests (B5)
```

**Why this shape:** `platform/` is the only thing every module may import. `modules/*` may import `platform` but never each other. `connectors/` is built into its own container and shares only the canonical event/contract definitions. `app/main.py` is the single composition root that wires together *only the modules a tenant has enabled*.

## B2. Anatomy of a module

Every module package is identical in shape. Example, `modules/m4_oee/`:

```
m4_oee/
├── manifest.py        # ModuleManifest: identity, deps, events, routers, migrations, flag key
├── api/               # FastAPI routers (REST /v1/oee/...). Mounted by the gateway.
├── domain/            # business logic. Pure-ish; no FastAPI, no other module.
├── schema/            # SQLAlchemy models — ALL in the `oee` Postgres schema only.
├── events/
│   ├── consumers.py   # subscribes to canonical events it needs (e.g. production.counted)
│   └── produced.py    # canonical events it emits (registered in the event catalog)
├── migrations/        # Alembic revisions for the `oee` schema only
├── read.py            # thin read access to canonical Serving zone (via platform.canonical)
├── writeback.py       # thin write of derived intelligence (via platform.writeback)
└── tests/
```

**The manifest is the contract between a module and the core.** It is the single source of truth the registry reads.

```python
# modules/m4_oee/manifest.py
from platform.registry import ModuleManifest

manifest = ModuleManifest(
    code="M4",
    name="OEE & Downtime Intelligence",
    db_schema="oee",
    feature_flag="module.m4_oee",
    consumes_events=["production.counted", "downtime.logged", "shift.submitted"],
    produces_events=["oee.computed", "loss.attributed"],
    consumes_canonical=["ProductionCount", "DowntimeEvent", "ShiftCalendar"],
    router_module="modules.m4_oee.api",       # FastAPI APIRouter
    consumer_module="modules.m4_oee.events.consumers",
    migrations_path="modules/m4_oee/migrations",
    depends_on=[],                             # MUST stay empty — no module dependencies
)
```

`depends_on` exists only to make the "no module dependencies" rule explicit and testable: a CI test asserts it is always empty. If a module ever "needs" another, that dependency must be re-expressed as a canonical event or field instead.

## B3. Database & schema ownership

- **One module → one schema.** `maint`, `plan`, `oee`, `yield_`, `qual`, `energy`. The canonical model lives in its own `canonical` schema (per `02_CanonicalDataModel_Spec`).
- **Migrations are per-module.** Each module has its own Alembic history under `modules/<m>/migrations`. A module migration may create/alter objects **only in its own schema**. A CI check greps migrations for foreign schema references and fails on violation.
- **Enforce read isolation at the database, not just in code.** Give each module its own Postgres role whose `search_path` is its own schema, with **read-only `GRANT SELECT`** on the canonical Serving *views* and nothing on other modules' schemas. This makes "reach into another module's table" fail at the DB even if code tries.

```sql
-- one role per module; example for M4
CREATE ROLE app_m4 LOGIN;
GRANT USAGE ON SCHEMA oee TO app_m4;
GRANT ALL    ON ALL TABLES IN SCHEMA oee TO app_m4;     -- owns its schema
GRANT USAGE  ON SCHEMA canonical TO app_m4;
GRANT SELECT ON ALL TABLES IN SCHEMA canonical TO app_m4; -- read-only canonical
-- (no grants on maint, plan, qual, yield_, energy)
ALTER ROLE app_m4 SET search_path = oee, canonical;
```

- **Tenant scoping is orthogonal and always on (D8).** Every row carries `tenant_id`; the `platform.db` session sets the tenant context (and, where used, Postgres RLS) so no query can cross tenants. Module code never writes raw tenant filters by hand — it goes through the platform session.

## B4. How modules communicate (the only three channels)

There are exactly three legal ways data crosses a module boundary. Anything else is a violation.

| Channel | Use it for | Mechanism |
|---|---|---|
| **Canonical read** | "I need production counts / downtime / a coil's genealogy" | `platform.canonical` → read-only SELECT on canonical Serving views. |
| **Canonical event (Kafka)** | "Something happened that others may react to" | `platform.eventbus` publish/subscribe; events are versioned canonical domain events (e.g. `oee.computed`). At-least-once + idempotent consumers. |
| **Write-back** | "Persist my derived result so it becomes canonical" | `platform.writeback` → canonical write-back API. |

**Event envelope (standardize once, in `platform.eventbus`):**

```json
{
  "event": "oee.computed",
  "version": 1,
  "tenant_id": "acme",
  "occurred_at": "2026-06-20T08:15:00Z",
  "key": "LINE_A:2026-06-20:SHIFT_1",
  "payload": { "...": "canonical fields only" },
  "lineage_ref": "batch:.../row:.../mapping:v3",
  "correlation_id": "..."
}
```

**Worked example of the rule (M4 needs a production count):** M4 does **not** call M3 and does **not** read M3's tables. M3's planning/execution produces the canonical `ProductionCount` (one count, one owner — per your documented M3↔M4 seam). M4 reads `ProductionCount` from the canonical Serving zone, or reacts to the `production.counted` event. Neither module imports the other. This is exactly the seam you'll later cut along if M4 is extracted.

## B5. Boundary enforcement (CI/tests) — make the rules mechanical

Rules that rely on goodwill rot. Enforce all of these in CI; a violation **fails the build**.

**1. No cross-module imports — `import-linter`.**

```ini
# importlinter.ini
[importlinter]
root_packages = platform, modules, connectors

[importlinter:contract:modules-are-independent]
name = Modules must not import each other
type = independence
modules =
    modules.m2_maintenance
    modules.m3_planning
    modules.m4_oee
    modules.m5_yield
    modules.m6_quality
    modules.m7_energy

[importlinter:contract:platform-has-no-module-deps]
name = Platform kernel must not import modules
type = forbidden
source_modules = platform
forbidden_modules = modules, connectors

[importlinter:contract:connectors-isolated]
name = Connectors must not import modules
type = forbidden
source_modules = connectors
forbidden_modules = modules
```

**2. No foreign-schema access — migration + model lint.** A CI script asserts each module's SQLAlchemy models declare only its own `__table_args__ = {"schema": "<own>"}`, and greps `migrations/` for any other schema name. Fail on match. (Belt-and-braces with the DB roles in B3.)

**3. `depends_on` is empty.** A test imports every `manifest.py` and asserts `depends_on == []`.

**4. Canonical contract tests.** Each module's manifest declares `consumes_canonical` and `consumes_events`. A contract test validates every declared field/event against the canonical schema registry (`02_CanonicalDataModel_Spec`). If someone changes a canonical field a module relies on, **that module's contract test breaks in CI** — the boundary surfaces the impact instead of failing silently in prod.

**5. Event-schema compatibility.** Produced events are validated against registered JSON schemas; a breaking change requires a new `version` (consumers handle v1 and v2 during migration). Enforce with a schema-registry compatibility check in CI.

**CI gate order (fail fast):** `import-linter` → schema-access lint → `depends_on` test → per-module unit tests → canonical contract tests → event-compat check → migration dry-run. Green on all = boundaries intact.

## B6. Module on/off + tenant configuration

**The registry discovers modules; tenant config decides which run.** No code change to enable/disable.

```python
# app/main.py  — composition root (simplified)
from fastapi import FastAPI
from platform.registry import discover_manifests
from platform.tenant import load_tenant_config

def build_app() -> FastAPI:
    app = FastAPI()
    manifests = discover_manifests("modules")          # finds every manifest.py
    for m in manifests:
        app.state.registry.add(m)                      # known, not necessarily active
    return app
```

```python
# per-request (or per-tenant worker) activation
def active_modules(tenant_id: str, registry) -> list[ModuleManifest]:
    cfg = load_tenant_config(tenant_id)                # {enabled_modules: ["M2","M4"], flags: {...}}
    return [m for m in registry.all()
            if m.code in cfg.enabled_modules
            and cfg.flags.get(m.feature_flag, True)]
```

- **Routers:** the gateway mounts a module's REST routes only if it's active for the tenant; a disabled module's endpoints return 404/“not enabled”, never a 500.
- **Consumers:** the Kafka consumer runner starts only the consumer groups of active modules. A disabled module simply doesn't subscribe — its absence cannot break another module (events it would have consumed are just not consumed by it).
- **Feature flags** gate *sub-features within* a module (e.g. M4 "predictive loss" off until data is ready), separate from the module on/off switch.
- **Tenant config object** (already specified in `08_Platform_Security_Spec`): `deployment_mode`, `latency_target`, `isolation_level`, `enabled_modules`, `flags`, `branding`, `cost_rate_ownership`. This is the *only* place per-customer differences live.

**Result:** Customer A = `["M1*, M3, M4"]`, Customer B = `["M1*, M2, M6"]`, Customer C = `["M1*, M4, M5, M7"]` — all the same binary, three config rows. (*M1 = connectors, provisioned separately per B7.)

## B7. The connector side (M1 / Manifold) stays separate

M1 is **not** a module in the core; it's a separate deployable built on a stable connector interface. This is what keeps all per-client customization out of the product.

```python
# connectors/framework/base.py
class Connector(Protocol):
    def discover(self) -> SourceProfile: ...
    def read(self, since: Cursor) -> Iterable[RawRecord]: ...
    def to_canonical(self, raw: RawRecord) -> list[CanonicalEvent]: ...  # the ONLY custom part
```

A new client = a new plugin under `connectors/plugins/<client>/` implementing this interface and emitting canonical events. The core never changes. Connectors deploy at the edge (Redpanda/k3s per D1) and feed the corridor. Reuse the Zinance import UX patterns per D10; the engine is server-side.

## B8. Definition of Done — per module

A module is "done and modular" when **all** are true:

- [ ] Owns exactly one schema; its own Alembic history; its own DB role (B3).
- [ ] Reads only via `platform.canonical`; writes only via `platform.writeback` (B4).
- [ ] `manifest.py` complete; `depends_on == []`.
- [ ] No import of any other `modules.*` package (import-linter green).
- [ ] Consumed canonical fields/events declared and contract-tested (B5).
- [ ] Produced events have registered, versioned schemas.
- [ ] Activates/deactivates purely via tenant config; disabling it breaks nothing else.
- [ ] Unit + contract tests pass; observability tagged `tenant_id` + `component`.

---

# Part C — Extraction-to-Service Playbook & Troubleshooting

## C1. Extracting a module into its own service

Run this **only after an A4 trigger fires.** Because boundaries were enforced, this is packaging + routing, not redesign. Example: extracting **M4**.

1. **Confirm the trigger** and the DoD (B8) is fully green for the module. If DoD isn't green, fix the boundary leaks *first* — that's the real work, and it's the same work that should already be done.
2. **Give it its own image.** New FastAPI service wrapping `modules/m4_oee` + the slice of `platform/` it uses (canonical client, eventbus, writeback, auth, observability). The module code is unchanged.
3. **Point it at its data.** Its schema (`oee`) is already isolated; optionally move it to its own DB instance. No table reshaping needed.
4. **Switch the channels from in-process to network — but the contract is identical.** It already only used canonical read / events / write-back, so this is configuration: canonical reads hit the serving API over the network; events flow over the same Kafka topics; write-back hits the canonical API endpoint. No business logic changes.
5. **Reroute the gateway.** Point `/v1/oee/*` at the new service URL; remove M4 from the in-core composition for tenants served by the new service (a config change).
6. **Move migration ownership** to the service's pipeline.
7. **Now "per-service" observability is literally true** — the spec-08 wording finally applies as written (see D12 consequences).
8. **Decommission the in-core module** once traffic is cut over.

**M1 note:** M1 is *already* separate, so "extracting M1" means scaling/replicating connectors independently per client at the edge — provisioning work, not extraction. It's first on the list because per-client connector load grows fastest, not because it needs un-tangling.

## C2. Anti-patterns — how the modular monolith dies, and how to avoid it

| Anti-pattern (the problem) | Why it's tempting | Do this instead |
|---|---|---|
| Reading another module's tables directly | "It's right there, a JOIN is easy" | Read the canonical field, or consume its event. DB roles (B3) should block the JOIN anyway. |
| `from modules.m3_planning import ...` | "I just need one function" | Re-express as a canonical event/field. import-linter will fail the build. |
| Synchronous module-to-module HTTP/function call | Feels simpler than events | Use a canonical event (async, idempotent) or canonical read. Sync calls re-couple deploys. |
| A shared "common business models" package across modules | DRY instinct | Only the *canonical* model is shared. Module-specific models stay in the module. Shared ≠ canonical. |
| `if tenant == "acme"` inside a module | Quick client fix | Move it to that client's connector, or to tenant config/flags. Modules are client-agnostic. |
| Distributed transaction across modules | "These two writes must be atomic" | Redesign as idempotent event reactions; accept eventual consistency. No 2-phase commit. |
| Extracting a module "to be safe / future-proof" | Microservices feel grown-up | Don't. Extract on a real A4 trigger only. Premature extraction pays cost for no benefit. |
| Letting `platform/` import a module | Convenience helper | Forbidden (import-linter). The kernel must never depend on a room. |
| Skipping the canonical contract test | "It builds, ship it" | Without it, a canonical change breaks modules silently in prod. The test is the boundary's smoke alarm. |

## C3. Common questions the team will hit

- **"My module genuinely needs data another module computes."** Then that data should be *canonical* — it's produced via write-back and an event, and you read it from the canonical zone. If it isn't canonical yet, that's a canonical-model gap to raise against `02`, not a reason to couple modules.
- **"Two modules need the same helper logic."** If it's domain logic, duplicate it (small duplication beats coupling) or, if it's truly generic and stateless, promote it into `platform/` (the kernel) — never into one module that the other imports.
- **"Isn't one big process a single point of failure?"** Per D12/`08`, the core scales horizontally (stateless services behind the gateway, data partitioned by tenant+time). One process *type*, many replicas. Extraction is for independent *scaling*, not for basic availability.
- **"How do we test a module in isolation?"** Mock the three channels (`platform.canonical`, `platform.eventbus`, `platform.writeback`). Because those are the only ways out of a module, that's a complete test boundary.

---

*This guide is binding alongside D12. If reality forces a deviation, amend D12 and this guide together — don't let the code and the decision drift apart.*
