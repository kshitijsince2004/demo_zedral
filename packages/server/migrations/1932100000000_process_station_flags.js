const isProd = process.env.NODE_ENV === 'production';
const enabledByDefault = !isProd;

const stationFlags = {
    'station.hrs': enabledByDefault,
    'station.pkl': enabledByDefault,
    'station.ann': enabledByDefault,
    'station.rwd': enabledByDefault,
    'station.crs': enabledByDefault,
    'station.ctl': enabledByDefault,
};

exports.up = (pgm) => {
    pgm.sql(`
        UPDATE security.tenant_config
        SET
            flags = COALESCE(flags, '{}'::jsonb) || '${JSON.stringify(stationFlags)}'::jsonb,
            updated_at = now();
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        UPDATE security.tenant_config
        SET
            flags = flags
                - 'station.hrs'
                - 'station.pkl'
                - 'station.ann'
                - 'station.rwd'
                - 'station.crs'
                - 'station.ctl',
            updated_at = now();
    `);
};
