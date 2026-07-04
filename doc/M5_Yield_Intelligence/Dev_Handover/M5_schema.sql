-- =====================================================================
-- Zedral · M5 Yield Intelligence — Reference Schema (PostgreSQL 15+)
-- Status: v1 for build (dual-basis yield: material/mass + FPY/RTY count;
--         mass-balance reconciliation; priced loss bridge; genealogy
--         attribution). v1 bootstraps from M1 manual weights/counts/
--         COIL_NO genealogy; auto weighing/length/vision future-proofed
--         (deep-plan §5). Prediction hooks present, build deferred (§8).
-- Conventions: follows canonical DDL spec (02_CanonicalDataModel_Spec §5):
--   lower_snake_case · surrogate BIGINT ids · UUID tenant_id · TIMESTAMPTZ (UTC)
--   JSONB `ext` extension namespace · FK to canon.* · units embedded in column name.
-- Assumes the canonical core already exists:
--   canon.equipment_node(node_id)      -- ISA-95 hierarchy incl. WORK_CENTER & WORK_UNIT
--   canon.event(event_id)              -- Event Spine; production_count is a specialization
--   canon.production_count(count_id)   -- good/scrap/rework/total (+ weight) — the shared count
--   canon.material_lot(lot_id, parent_lot_id) -- genealogy spine (M1 COIL_NO)
--   canon.material(material_id)        -- material/grade reference
--   canon.shift(shift_id)              -- shift/calendar
--   canon.reason_code(reason_id, loss_category_ref) -- canonical scrap/loss reason taxonomy
--   canon.loss_category(category_id, oee_component) -- Six Big Losses (ISO 22400/TPM)
--   canon.cost_rate(rate_id ...)       -- effective-dated rates (D7)
-- SOFT-REFERENCE RULE: references to OTHER module schemas (e.g. ops.route in M3,
--   qual.defect_record in M6) are plain BIGINT *_ref values with NO cross-schema
--   hard FK, so canon/M5 stay independent. Hard FKs are used ONLY to canon.* —
--   the same discipline M2/M3/M4 use.
-- THE no-double-count anchor: yield.* rows carry the canonical production_count_id /
--   material_lot_id of the SAME ProductionCount that M4 (Quality factor), M3
--   (attainment) and M6 (defect) read — M5 aggregates the material/yield view,
--   it never re-records the count.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS "yield";
SET search_path = "yield", canon, public;

-- ---------------------------------------------------------------------
-- 0. Enumerated types
-- ---------------------------------------------------------------------
CREATE TYPE "yield".quantity_basis        AS ENUM ('MASS','COUNT','BOTH');
CREATE TYPE "yield".quantity_class        AS ENUM ('GOOD','SCRAP','PLANNED_SCRAP','REWORK','BYPRODUCT');
CREATE TYPE "yield".recoverability        AS ENUM ('PURE_LOSS','SALVAGE','RECOVERABLE');
CREATE TYPE "yield".big_loss              AS ENUM ('L5_DEFECT','L6_STARTUP_YIELD','L1_BREAKDOWN_LINKED');
CREATE TYPE "yield".expected_yield_source AS ENUM ('METALLURGICAL_STD','DEMONSTRATED_BEST','M3_PLAN_FACTOR','MANUAL');
CREATE TYPE "yield".capture_fidelity      AS ENUM ('MANUAL','INGESTED','AUTOMATIC');
CREATE TYPE "yield".time_grain            AS ENUM ('SHIFT','DAY','WEEK','MONTH');
CREATE TYPE "yield".rank_basis            AS ENUM ('MASS','UNITS','COST');
CREATE TYPE "yield".readiness_gate        AS ENUM ('REQUIRED','QUALITY','FIDELITY','HISTORY');
CREATE TYPE "yield".balance_status        AS ENUM ('CLOSED','PROVISIONAL','DEVIATION');

-- ---------------------------------------------------------------------
-- 1. Yield reference & policy
-- ---------------------------------------------------------------------

-- 1.1 Per-tenant yield policy (definitions-as-configuration)
CREATE TABLE "yield".yield_config (
    config_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id              UUID        NOT NULL,
    default_quantity_basis "yield".quantity_basis NOT NULL DEFAULT 'BOTH',
    recon_tolerance_pct    NUMERIC(5,2) NOT NULL DEFAULT 2.00,  -- mass-balance close tolerance (+/- %)
    default_expected_source "yield".expected_yield_source NOT NULL DEFAULT 'METALLURGICAL_STD',
    net_salvage            BOOLEAN     NOT NULL DEFAULT TRUE,    -- net loss cost against scrap salvage value
    report_avoidable_only  BOOLEAN     NOT NULL DEFAULT TRUE,    -- Pareto on (actual - planned scrap)
    effective_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to           TIMESTAMPTZ,
    ext                    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, effective_from)
);

-- 1.2 Per work-unit capture/basis configuration
CREATE TABLE "yield".work_unit_config (
    work_unit_config_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    work_unit_ref        BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    quantity_basis       "yield".quantity_basis  NOT NULL DEFAULT 'BOTH',
    capture_fidelity     "yield".capture_fidelity NOT NULL DEFAULT 'MANUAL',
    genealogy_required   BOOLEAN     NOT NULL DEFAULT TRUE,
    ext                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, work_unit_ref)
);

-- 1.3 Expected-yield factor (route x grade x work-unit, versioned, calibrated-flag)
--     = the Planned-Scrap (PSQ) baseline and the avoidable-loss reference.
CREATE TABLE "yield".expected_yield_factor (
    factor_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    work_unit_ref        BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    material_ref         BIGINT      NOT NULL REFERENCES canon.material(material_id),
    route_ref            BIGINT,                                 -- soft ref to ops.route (M3)
    expected_yield_pct   NUMERIC(6,3) NOT NULL,                  -- standard material yield
    planned_scrap_pct    NUMERIC(6,3) NOT NULL DEFAULT 0,        -- PSQ baseline
    source               "yield".expected_yield_source NOT NULL,
    is_calibrated        BOOLEAN     NOT NULL DEFAULT FALSE,     -- drives Fidelity gate
    version              INTEGER     NOT NULL DEFAULT 1,
    effective_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to         TIMESTAMPTZ,
    ext                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expected_yield_pct > 0 AND expected_yield_pct <= 100),
    CHECK (planned_scrap_pct >= 0 AND planned_scrap_pct < 100),
    UNIQUE (tenant_id, work_unit_ref, material_ref, version)
);

-- 1.4 Yield targets
CREATE TABLE "yield".yield_target (
    target_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    scope_node_ref       BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    material_ref         BIGINT      REFERENCES canon.material(material_id),
    target_material_yield_pct NUMERIC(6,3),
    target_rty_pct       NUMERIC(6,3),
    effective_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to         TIMESTAMPTZ,
    ext                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. Mass balance (the conservation-of-mass close)
-- ---------------------------------------------------------------------
CREATE TABLE "yield".material_balance (
    balance_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    lot_ref              BIGINT      REFERENCES canon.material_lot(lot_id),  -- per-lot close (nullable for window close)
    work_unit_ref        BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    shift_ref            BIGINT      REFERENCES canon.shift(shift_id),
    window_start         TIMESTAMPTZ NOT NULL,
    window_end           TIMESTAMPTZ NOT NULL,
    input_mt             NUMERIC(14,4) NOT NULL,
    good_mt              NUMERIC(14,4) NOT NULL DEFAULT 0,
    scrap_mt             NUMERIC(14,4) NOT NULL DEFAULT 0,
    rework_mt            NUMERIC(14,4) NOT NULL DEFAULT 0,
    byproduct_mt         NUMERIC(14,4) NOT NULL DEFAULT 0,
    dwip_mt              NUMERIC(14,4) NOT NULL DEFAULT 0,       -- delta WIP across the window boundary
    gap_mt               NUMERIC(14,4) NOT NULL DEFAULT 0,       -- Input - accounted Output (signed)
    gap_pct              NUMERIC(7,4)  NOT NULL DEFAULT 0,
    status               "yield".balance_status NOT NULL DEFAULT 'PROVISIONAL',
    fidelity             "yield".capture_fidelity NOT NULL DEFAULT 'MANUAL',
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ext                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    CHECK (window_end > window_start),
    CHECK (input_mt >= 0)
);
CREATE INDEX ix_balance_wu_window ON "yield".material_balance (work_unit_ref, window_start);
CREATE INDEX ix_balance_lot       ON "yield".material_balance (lot_ref);
CREATE INDEX ix_balance_status    ON "yield".material_balance (status) WHERE status <> 'CLOSED';

-- ---------------------------------------------------------------------
-- 3. Yield intervals (computed dual-basis yield per asset x material x bucket)
-- ---------------------------------------------------------------------
CREATE TABLE "yield".yield_interval (
    interval_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    work_unit_ref        BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    material_ref         BIGINT      REFERENCES canon.material(material_id),
    grain                "yield".time_grain NOT NULL,
    bucket_start         TIMESTAMPTZ NOT NULL,
    bucket_end           TIMESTAMPTZ NOT NULL,
    -- quantities (store quantities, not just ratios) — both bases
    input_mt             NUMERIC(14,4) NOT NULL DEFAULT 0,
    good_mt              NUMERIC(14,4) NOT NULL DEFAULT 0,
    scrap_mt             NUMERIC(14,4) NOT NULL DEFAULT 0,
    rework_mt            NUMERIC(14,4) NOT NULL DEFAULT 0,
    input_units          NUMERIC(14,2) NOT NULL DEFAULT 0,
    good_units           NUMERIC(14,2) NOT NULL DEFAULT 0,
    scrap_units          NUMERIC(14,2) NOT NULL DEFAULT 0,
    rework_units         NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- derived ratios (kept for serving; always re-derivable from quantities)
    material_yield_pct   NUMERIC(7,4),
    fpy_pct              NUMERIC(7,4),
    rty_pct              NUMERIC(7,4),                            -- product of FPY across child steps (set by rollup job)
    quality_ratio_pct    NUMERIC(7,4),
    scrap_ratio_pct      NUMERIC(7,4),
    rework_ratio_pct     NUMERIC(7,4),
    planned_scrap_mt     NUMERIC(14,4) NOT NULL DEFAULT 0,        -- PSQ
    avoidable_loss_mt    NUMERIC(14,4) NOT NULL DEFAULT 0,        -- actual loss - planned scrap
    fidelity             "yield".capture_fidelity NOT NULL DEFAULT 'MANUAL',
    balance_ref          BIGINT      REFERENCES "yield".material_balance(balance_id),
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ext                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    CHECK (bucket_end > bucket_start),
    UNIQUE (tenant_id, work_unit_ref, material_ref, grain, bucket_start)
);
CREATE INDEX ix_yint_wu_bucket ON "yield".yield_interval (work_unit_ref, grain, bucket_start);
CREATE INDEX ix_yint_material  ON "yield".yield_interval (material_ref);

-- ---------------------------------------------------------------------
-- 4. Loss attribution (every lost kg/unit, priced, genealogy-traced)
-- ---------------------------------------------------------------------
CREATE TABLE "yield".loss_attribution (
    attr_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    interval_ref         BIGINT      NOT NULL REFERENCES "yield".yield_interval(interval_id),
    production_count_id  BIGINT      REFERENCES canon.production_count(count_id),  -- no-double-count anchor
    lot_ref              BIGINT      REFERENCES canon.material_lot(lot_id),         -- genealogy step
    reason_ref           BIGINT      NOT NULL REFERENCES canon.reason_code(reason_id),
    loss_category_ref    BIGINT      NOT NULL REFERENCES canon.loss_category(category_id),
    quantity_class       "yield".quantity_class NOT NULL,
    recoverability       "yield".recoverability NOT NULL,
    big_loss             "yield".big_loss NOT NULL,
    defect_ref           BIGINT,                                  -- soft ref to qual.defect_record (M6)
    loss_mt              NUMERIC(14,4) NOT NULL DEFAULT 0,
    loss_units           NUMERIC(14,2) NOT NULL DEFAULT 0,
    standard_cost        NUMERIC(16,2) NOT NULL DEFAULT 0,        -- sunk conversion + material (hits twice)
    salvage_value        NUMERIC(16,2) NOT NULL DEFAULT 0,        -- scrap recovery
    rework_cost          NUMERIC(16,2) NOT NULL DEFAULT 0,        -- added cost where recoverable
    net_loss_cost        NUMERIC(16,2) NOT NULL DEFAULT 0,        -- standard_cost - salvage + rework_cost
    cost_rate_ref        BIGINT      REFERENCES canon.cost_rate(rate_id),
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ext                  JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_loss_interval ON "yield".loss_attribution (interval_ref);
CREATE INDEX ix_loss_reason   ON "yield".loss_attribution (reason_ref);
CREATE INDEX ix_loss_lot      ON "yield".loss_attribution (lot_ref);

-- ---------------------------------------------------------------------
-- 5. Loss bridge & top-loss Pareto (snapshots for serving)
-- ---------------------------------------------------------------------
CREATE TABLE "yield".loss_bridge (
    bridge_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    scope_node_ref       BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    material_ref         BIGINT      REFERENCES canon.material(material_id),
    grain                "yield".time_grain NOT NULL,
    bucket_start         TIMESTAMPTZ NOT NULL,
    input_mt             NUMERIC(14,4) NOT NULL,
    good_mt              NUMERIC(14,4) NOT NULL,
    steps                JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- ordered waterfall [{category, loss_mt, loss_cost}]
    total_loss_cost      NUMERIC(16,2) NOT NULL DEFAULT 0,
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope_node_ref, material_ref, grain, bucket_start)
);

CREATE TABLE "yield".top_loss (
    top_loss_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    scope_node_ref       BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    grain                "yield".time_grain NOT NULL,
    bucket_start         TIMESTAMPTZ NOT NULL,
    rank_basis           "yield".rank_basis NOT NULL,
    rank                 INTEGER     NOT NULL,
    reason_ref           BIGINT      REFERENCES canon.reason_code(reason_id),
    loss_category_ref    BIGINT      REFERENCES canon.loss_category(category_id),
    value_mt             NUMERIC(14,4),
    value_units          NUMERIC(14,2),
    value_cost           NUMERIC(16,2),
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope_node_ref, grain, bucket_start, rank_basis, rank)
);

-- ---------------------------------------------------------------------
-- 6. Yield-factor feedback to planning (M3)
-- ---------------------------------------------------------------------
CREATE TABLE "yield".yield_factor_feedback (
    feedback_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    route_ref            BIGINT,                                  -- soft ref to ops.route (M3)
    material_ref         BIGINT      REFERENCES canon.material(material_id),
    work_unit_ref        BIGINT      REFERENCES canon.equipment_node(node_id),
    window_start         TIMESTAMPTZ NOT NULL,
    window_end           TIMESTAMPTZ NOT NULL,
    actual_yield_pct     NUMERIC(7,4) NOT NULL,
    expected_yield_pct   NUMERIC(7,4) NOT NULL,
    delta_pct            NUMERIC(7,4) NOT NULL,
    published_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    ext                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    CHECK (window_end > window_start)
);

-- ---------------------------------------------------------------------
-- 7. Policy change log (audit; effective-dated, replay-safe)
-- ---------------------------------------------------------------------
CREATE TABLE "yield".policy_change_log (
    change_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    entity              TEXT        NOT NULL,                     -- 'yield_config' | 'expected_yield_factor' | ...
    entity_pk            BIGINT      NOT NULL,
    change_kind          TEXT        NOT NULL,                    -- 'CREATE' | 'UPDATE' | 'RETIRE'
    old_value            JSONB,
    new_value            JSONB,
    changed_by           UUID        NOT NULL,
    effective_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_policy_change_entity ON "yield".policy_change_log (entity, entity_pk);

-- ---------------------------------------------------------------------
-- 8. Readiness snapshot (Required / Quality / Fidelity / History gates)
-- ---------------------------------------------------------------------
CREATE TABLE "yield".readiness_snapshot (
    snapshot_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    work_unit_ref        BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    gate                 "yield".readiness_gate NOT NULL,
    score_pct            NUMERIC(6,2) NOT NULL DEFAULT 0,
    genealogy_complete   BOOLEAN     NOT NULL DEFAULT FALSE,
    expected_calibrated  BOOLEAN     NOT NULL DEFAULT FALSE,
    recon_within_tol     BOOLEAN     NOT NULL DEFAULT FALSE,
    fidelity             "yield".capture_fidelity NOT NULL DEFAULT 'MANUAL',
    detail               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, work_unit_ref, gate)
);

-- ---------------------------------------------------------------------
-- 9. Yield prediction (FUTURE SCOPE — stub, build gated §8)
-- ---------------------------------------------------------------------
CREATE TABLE "yield".yield_prediction (
    prediction_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            UUID        NOT NULL,
    work_unit_ref        BIGINT      NOT NULL REFERENCES canon.equipment_node(node_id),
    material_ref         BIGINT      REFERENCES canon.material(material_id),
    route_ref            BIGINT,
    horizon              TEXT        NOT NULL,                    -- e.g. 'NEXT_RUN' | 'NEXT_SHIFT'
    predicted_yield_pct  NUMERIC(7,4),
    predicted_loss_cost  NUMERIC(16,2),
    model_version        TEXT,
    confidence_pct       NUMERIC(6,2),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    ext                  JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------
-- 10. Rollup view — SUM-then-divide material yield (NEVER average sub-yields)
--     RTY (product of FPY) is computed in the KPI registry, not here.
-- ---------------------------------------------------------------------
CREATE VIEW "yield".v_yield_rollup AS
SELECT
    yi.tenant_id,
    yi.work_unit_ref,
    yi.material_ref,
    yi.grain,
    date_trunc('day', yi.bucket_start) AS day_bucket,
    SUM(yi.input_mt)                   AS input_mt,
    SUM(yi.good_mt)                    AS good_mt,
    SUM(yi.scrap_mt)                   AS scrap_mt,
    SUM(yi.rework_mt)                  AS rework_mt,
    SUM(yi.avoidable_loss_mt)          AS avoidable_loss_mt,
    CASE WHEN SUM(yi.input_mt) > 0
         THEN ROUND(100.0 * SUM(yi.good_mt) / SUM(yi.input_mt), 4)
         ELSE NULL END                 AS material_yield_pct
FROM "yield".yield_interval yi
GROUP BY yi.tenant_id, yi.work_unit_ref, yi.material_ref, yi.grain, date_trunc('day', yi.bucket_start);

-- =====================================================================
-- End of M5 reference schema.
-- =====================================================================
