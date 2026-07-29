import type { Server } from 'http';
import { initEventBus, shutdownEventBus } from '@zedral/platform';
import { ExportWorker } from './export/jobs/ExportWorker';
import { ExportScheduler } from './export/jobs/ExportScheduler';
import { ShiftBoundaryScheduler } from './jobs/ShiftBoundaryScheduler';
import { checkElasticHealth } from './elastic/elasticClient';
import { ensureIndex } from './elastic/traceabilityIndex';
import { db } from './db';
import { validateAuthConfigAtStartup } from './config/authConfig';
import { DefaultRuleSeeder } from './services/DefaultRuleSeeder';
import { buildApp } from './app';
import { buildModuleRegistry } from './modules/registerModules';
import { registerJourneyAdvanceConsumer } from './modules/m1-collection/register';
import { startModuleRuntime, type ModuleRuntime } from './modules/moduleRuntime';

validateAuthConfigAtStartup();

const port = Number(process.env.PORT || 3005);
const host = process.env.HOST?.trim() || '0.0.0.0';
process.env.CANONICAL_WRITEBACK_URL ??= `http://127.0.0.1:${port}/v1/canon`;

initEventBus();
registerJourneyAdvanceConsumer();
const registry = buildModuleRegistry();
const { app } = buildApp(registry);

let server: Server;
let moduleRuntime: ModuleRuntime | null = null;

server = app.listen(port, host, async () => {
  console.log(`Server listening on ${host}:${port}`);

  moduleRuntime = await startModuleRuntime(registry);

  // Seed validation rules
  const seeder = new DefaultRuleSeeder(db);
  await seeder.seed().catch(err => {
    console.error('Failed to seed validation rules:', err);
  });
  
  ExportWorker.start();
  ExportScheduler.start();
  ShiftBoundaryScheduler.start();

  // Elasticsearch — non-fatal; traceability falls back to PostgreSQL if unavailable
  checkElasticHealth().then(async (ok) => {
    if (ok) await ensureIndex();
  }).catch(() => { /* already logged in checkElasticHealth */ });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[startup] Port ${port} is already in use. Stop the other process (often another Zedral checkout) and retry.`,
    );
    process.exit(1);
  }
  console.error('[startup] HTTP server error', err);
  process.exit(1);
});

function shutdown(signal: string) {
  console.log(`[shutdown] ${signal} received — stopping background workers`);
  ExportWorker.stop();
  ExportScheduler.stop();
  ShiftBoundaryScheduler.stop();
  void moduleRuntime?.stop().catch((err) => {
    console.error('[shutdown] module runtime stop failed', err);
  });
  void shutdownEventBus().catch((err) => {
    console.error('[shutdown] event bus shutdown failed', err);
  });
  server.close(() => {
    console.log('[shutdown] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[shutdown] forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  shutdown('uncaughtException');
});
