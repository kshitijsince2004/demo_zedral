# M1 Module Migrations

`m1ManifestMeta.migrationsPath` points here to reserve the D12/D12b module-owned migration location for M1.

Historical M1/platform migrations that predate D12 remain in `packages/server/migrations` so existing environments keep their applied migration identifiers and ordering. New M1-only migrations should be added under this directory and registered through the server migration runner once the next migration is introduced.
