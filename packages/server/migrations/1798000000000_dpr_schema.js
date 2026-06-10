exports.up = (pgm) => {
  pgm.createSchema('dpr', { ifNotExists: true });

  pgm.createTable({ schema: 'dpr', name: 'template' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    original_file_blob: { type: 'bytea', notNull: false },
    blank_master_blob: { type: 'bytea', notNull: true },
    geometry_model: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    created_by: { type: 'uuid', notNull: false }
  });

  pgm.createTable({ schema: 'dpr', name: 'month' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    template_id: { type: 'uuid', notNull: true, references: { schema: 'dpr', name: 'template' } },
    year: { type: 'integer', notNull: true },
    month: { type: 'integer', notNull: true },
    sheet_code: { type: 'text', notNull: true },
    days_in_month: { type: 'integer', notNull: true },
    config_overrides: { type: 'jsonb', notNull: true, default: '{}' },
    status: { type: 'text', notNull: true, default: "'active'" },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable({ schema: 'dpr', name: 'daily_entry' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    month_id: { type: 'uuid', notNull: true, references: { schema: 'dpr', name: 'month' } },
    day_number: { type: 'integer', notNull: true },
    values: { type: 'jsonb', notNull: true, default: '{}' },
    delay_data: { type: 'jsonb', notNull: true, default: '[]' },
    field_provenance: { type: 'jsonb', notNull: true, default: '{}' },
    status: { type: 'text', notNull: true, default: "'entered'" },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  });

  pgm.addConstraint({ schema: 'dpr', name: 'daily_entry' }, 'daily_entry_month_day_unique', {
    unique: ['month_id', 'day_number']
  });

  pgm.createTable({ schema: 'dpr', name: 'source_map' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    field_id: { type: 'text', notNull: true, unique: true },
    status: { type: 'text', notNull: true },
    resolution_data: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable({ schema: 'dpr', name: 'field_mapping' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    field_id: { type: 'text', notNull: true, unique: true },
    adapter: { type: 'text', notNull: true },
    config: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  });
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'dpr', name: 'field_mapping' });
  pgm.dropTable({ schema: 'dpr', name: 'source_map' });
  pgm.dropTable({ schema: 'dpr', name: 'daily_entry' });
  pgm.dropTable({ schema: 'dpr', name: 'month' });
  pgm.dropTable({ schema: 'dpr', name: 'template' });
  pgm.dropSchema('dpr');
};
