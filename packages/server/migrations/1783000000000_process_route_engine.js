exports.up = (pgm) => {
  pgm.sql(`
    -- Route code lookup (internal codes — never shown in UI)
    CREATE TABLE IF NOT EXISTS master.route_code (
        route_code      VARCHAR(4)  PRIMARY KEY,
        display_label   VARCHAR(40) NOT NULL,
        process_code    VARCHAR(8),
        machine_code    VARCHAR(8)  REFERENCES master.machine(machine_code),
        sub_process     VARCHAR(16),
        seq_hint        SMALLINT    NOT NULL DEFAULT 0
    );

    INSERT INTO master.route_code (route_code, display_label, process_code, machine_code, sub_process, seq_hint) VALUES
    ('S',  'HR Slitting',   'HRS',  NULL,  NULL,        10),
    ('P',  'Pickling',      'PKL',  NULL,  NULL,        20),
    ('4',  '4HI Rolling',   'CRM6', '4HI', 'ROLLING',   30),
    ('6',  '6HI Rolling',   'CRM6', '6HI', 'ROLLING',   31),
    ('R',  'Rewinding',     'RWD',  NULL,  NULL,        40),
    ('F',  'Annealing',     'ANN',  NULL,  NULL,        50),
    ('X',  '2HI Skin Pass', 'CRM6', '2HI', 'SKIN_PASS', 60),
    ('Y',  '4HI Skin Pass', 'CRM6', '4HI', 'SKIN_PASS', 61),
    ('Z',  '6HI Skin Pass', 'CRM6', '6HI', 'SKIN_PASS', 62),
    ('C',  'CR Slitting',   'CRS',  NULL,  NULL,        70),
    ('LE', 'CTL',           'CTL',  NULL,  NULL,        80),
    ('PKG','Packaging',     NULL,   NULL,  NULL,        99)
    ON CONFLICT (route_code) DO NOTHING;

    -- Machine registry expansion
    ALTER TABLE master.machine
      ADD COLUMN IF NOT EXISTS process_code VARCHAR(8),
      ADD COLUMN IF NOT EXISTS machine_status VARCHAR(16) NOT NULL DEFAULT 'OPERATIONAL'
        CHECK (machine_status IN ('OPERATIONAL','MAINTENANCE','OFFLINE'));

    UPDATE master.machine SET process_code = 'CRM6' WHERE machine_code IN ('6HI','4HI','2HI');

    INSERT INTO master.machine (machine_code, process_id, name, process_code) VALUES
    ('PKL',  (SELECT process_id FROM master.process WHERE code = 'PKL' LIMIT 1),  'Pickling',    'PKL'),
    ('ANN',  (SELECT process_id FROM master.process WHERE code = 'ANN' LIMIT 1),  'Annealing',   'ANN'),
    ('RWD',  (SELECT process_id FROM master.process WHERE code = 'RWD' LIMIT 1),  'Rewinding',   'RWD'),
    ('CRS',  (SELECT process_id FROM master.process WHERE code = 'CRS' LIMIT 1),  'CR Slitting', 'CRS'),
    ('CTL',  (SELECT process_id FROM master.process WHERE code = 'CTL' LIMIT 1),  'CTL',         'CTL'),
    ('HRS',  (SELECT process_id FROM master.process WHERE code = 'HRS' LIMIT 1),  'HR Slitting', 'HRS')
    ON CONFLICT (machine_code) DO UPDATE SET
      process_code = EXCLUDED.process_code,
      name = EXCLUDED.name;

    -- PPC process route (raw codes — internal only)
    ALTER TABLE planning.ppc_batch
      ADD COLUMN IF NOT EXISTS process_route_raw VARCHAR(60);

    -- Order journey
    CREATE TABLE IF NOT EXISTS planning.order_journey (
        journey_id        BIGSERIAL    PRIMARY KEY,
        coil_no           VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
        route_raw         VARCHAR(60)  NOT NULL,
        current_step_no   SMALLINT     NOT NULL DEFAULT 1,
        status            VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','COMPLETED','HOLD','REJECTED')),
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_order_journey_coil ON planning.order_journey (coil_no);

    CREATE TABLE IF NOT EXISTS planning.order_journey_step (
        step_id           BIGSERIAL    PRIMARY KEY,
        journey_id        BIGINT       NOT NULL REFERENCES planning.order_journey(journey_id) ON DELETE CASCADE,
        step_no           SMALLINT     NOT NULL,
        route_code        VARCHAR(4)   NOT NULL,
        display_label     VARCHAR(40)  NOT NULL,
        process_code      VARCHAR(8),
        machine_code      VARCHAR(8),
        sub_process       VARCHAR(16),
        status            VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','ACTIVE','COMPLETED','SKIPPED','HOLD','REJECTED')),
        started_at        TIMESTAMPTZ,
        completed_at      TIMESTAMPTZ,
        queue_batch_id    BIGINT       REFERENCES planning.ppc_batch(batch_id),
        UNIQUE (journey_id, step_no)
    );

    CREATE INDEX IF NOT EXISTS ix_journey_step_batch ON planning.order_journey_step (queue_batch_id);

    -- Queue handoff audit (idempotent enqueue)
    CREATE TABLE IF NOT EXISTS planning.queue_handoff (
        handoff_id        BIGSERIAL    PRIMARY KEY,
        journey_id        BIGINT       NOT NULL REFERENCES planning.order_journey(journey_id),
        source_step_id    BIGINT       NOT NULL REFERENCES planning.order_journey_step(step_id),
        target_step_no    SMALLINT     NOT NULL,
        target_batch_id   BIGINT       REFERENCES planning.ppc_batch(batch_id),
        source            VARCHAR(8)   NOT NULL DEFAULT 'AUTO',
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        UNIQUE (journey_id, source_step_id, target_step_no)
    );

    -- Machine Head role
    INSERT INTO security.role (role_id, role_name, description) VALUES
    (5, 'MACHINE_HEAD', 'Machine Head: Manages assigned machines')
    ON CONFLICT (role_id) DO NOTHING;

    -- Machine assignment (user → machine)
    CREATE TABLE IF NOT EXISTS security.machine_access (
        user_id       BIGINT       NOT NULL REFERENCES security.app_user(user_id) ON DELETE CASCADE,
        machine_code  VARCHAR(8)   NOT NULL REFERENCES master.machine(machine_code),
        access_level  VARCHAR(8)   NOT NULL DEFAULT 'MANAGE'
                      CHECK (access_level IN ('READ','WRITE','MANAGE')),
        assigned_by   BIGINT       REFERENCES security.app_user(user_id),
        assigned_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, machine_code)
    );

    -- Allow PREPARING status on CRM6 orders (UI/server unified)
    ALTER TABLE txn.crm6_order DROP CONSTRAINT IF EXISTS crm6_order_status_check;
    ALTER TABLE txn.crm6_order ADD CONSTRAINT crm6_order_status_check
      CHECK (status IN ('PENDING','PREPARING','IN_PROGRESS','STOPPAGE','COMPLETED'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS planning.queue_handoff;
    DROP TABLE IF EXISTS planning.order_journey_step;
    DROP TABLE IF EXISTS planning.order_journey;
    ALTER TABLE planning.ppc_batch DROP COLUMN IF EXISTS process_route_raw;
    DROP TABLE IF EXISTS security.machine_access;
    DELETE FROM security.role WHERE role_name = 'MACHINE_HEAD';
    DROP TABLE IF EXISTS master.route_code;
    ALTER TABLE master.machine DROP COLUMN IF EXISTS process_code;
    ALTER TABLE master.machine DROP COLUMN IF EXISTS machine_status;
    ALTER TABLE txn.crm6_order DROP CONSTRAINT IF EXISTS crm6_order_status_check;
    ALTER TABLE txn.crm6_order ADD CONSTRAINT crm6_order_status_check
      CHECK (status IN ('PENDING','IN_PROGRESS','STOPPAGE','COMPLETED'));
  `);
};
