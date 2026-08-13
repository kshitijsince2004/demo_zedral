/**
 * Shim: status columns now live in modules/m1/1909000000001_idempotency_key_status.js
 * (table is created by m1/1909, which runs AFTER main migrations on `up`).
 * Kept so environments that already applied this file stay consistent in pgmigrations.
 * @param {import('node-pg-migrate').MigrationBuilder} _pgm
 */
exports.up = () => {};

/** @param {import('node-pg-migrate').MigrationBuilder} _pgm */
exports.down = () => {};
