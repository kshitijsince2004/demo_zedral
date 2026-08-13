import type { Server } from 'http';
import { initEventBus, shutdownEventBus } from '@zedral/platform';
import { ExportWorker } from './export/jobs/ExportWorker';
import { ExportScheduler } from './export/jobs/ExportScheduler';
import { ShiftBoundaryScheduler } from './jobs/ShiftBoundaryScheduler';
import { JourneyHandoffScheduler } from './jobs/JourneyHandoffScheduler';
import { checkElasticHealth } from './elastic/elasticClient';
import { ensureIndex } from './elastic/traceabilityIndex';
import { initAppCache } from './cache';
import { checkRedisHealth } from './cache/health';
import { db } from './db';
import { validateAuthConfigAtStartup } from './config/authConfig';
import { assertDatabaseRoleAtStartup } from './dbRoleAssertion';
import { DefaultRuleSeeder } from './services/DefaultRuleSeeder';
import { buildApp } from './app';
import { buildModuleRegistry } from './modules/registerModules';
import { registerJourneyAdvanceConsumer } from './modules/m1-collection/register';
import { startModuleRuntime, type ModuleRuntime } from './modules/moduleRuntime';
import { logger } from './utils/logger';

validateAuthConfigAtStartup();

const port = Number(process.env.PORT || 3005);
const host = process.env.HOST?.trim() || '0.0.0.0';
process.env.CANONICAL_WRITEBACK_URL ??= `http://127.0.0.1:${port}/v1/canon`;

let server: Server;
let moduleRuntime: ModuleRuntime | null = null;

async function startServer(): Promise<void> {
  await assertDatabaseRoleAtStartup();

  initEventBus();
  registerJourneyAdvanceConsumer();
  const registry = buildModuleRegistry();
  const { app } = buildApp(registry);

  server = app.listen(port, host, async () => {
    logger.info(`Server listening on ${host}:${port}`);

    moduleRuntime = await startModuleRuntime(registry);

    const seeder = new DefaultRuleSeeder(db);
    await seeder.seed().catch((err) => {
      logger.error('Failed to seed validation rules:', err);
    });

    ExportWorker.start();
    ExportScheduler.start();
    ShiftBoundaryScheduler.start();
    JourneyHandoffScheduler.start();

    void initAppCache().catch((err) => {
      logger.error('[cache] Failed to initialize cache layer:', err);
    });

    checkRedisHealth()
      .then((ok) => {
        if (ok) logger.info('[cache] Redis health check passed');
        else if (process.env.REDIS_URL)
          logger.warn('[cache] Redis health check failed; using memory fallback');
      })
      .catch(() => {
        /* non-fatal */
      });

    checkElasticHealth()
      .then(async (ok) => {
        if (ok) await ensureIndex();
      })
      .catch(() => {
        /* already logged in checkElasticHealth */
      });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `[startup] Port ${port} is already in use. Stop the other process (often another Zedral checkout) and retry.`,
      );
      process.exit(1);
    }
    logger.error('[startup] HTTP server error', err);
    process.exit(1);
  });
}

void startServer().catch((err) => {
  logger.error('[startup]', err instanceof Error ? err.message : err);
  process.exit(1);
});

function shutdown(signal: string) {
  logger.info(`[shutdown] ${signal} received — stopping background workers`);
  ExportWorker.stop();
  ExportScheduler.stop();
  ShiftBoundaryScheduler.stop();
  JourneyHandoffScheduler.stop();
  void moduleRuntime?.stop().catch((err) => {
    logger.error('[shutdown] module runtime stop failed', err);
  });
  void shutdownEventBus().catch((err) => {
    logger.error('[shutdown] event bus shutdown failed', err);
  });
  server.close(() => {
    logger.info('[shutdown] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('[shutdown] forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('[uncaughtException]', err);
  shutdown('uncaughtException');
});
