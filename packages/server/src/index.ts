import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes';
import shiftLogRoutes from './routes/shiftLogRoutes';
import shiftRoutes from './routes/shiftRoutes';
import stoppageRoutes from './routes/stoppageRoutes';
import crewRoutes from './routes/crewRoutes';
import defectRoutes from './routes/defectRoutes';
import importRoutes from './routes/importRoutes';
import masterDataRoutes from './routes/masterDataRoutes';
import userRoutes from './routes/userRoutes';
import exportRoutes from './routes/exportRoutes';
import reportRoutes from './routes/reportRoutes';
import validationRulesRoutes from './routes/validationRulesRoutes';
import deviceRoutes from './routes/deviceRoutes';
import traceabilityRoutes from './routes/traceabilityRoutes';
import plannedCoilRoutes from './routes/plannedCoilRoutes';
import SixHiRoutes from './routes/sixHiRoutes';
import liveRoutes from './routes/liveRoutes';
import machineRoutes from './routes/machineRoutes';
import machineAccessRoutes from './routes/machineAccessRoutes';
import machineHandoverRoutes from './routes/machineHandoverRoutes';
import auditRoutes from './routes/auditRoutes';
import { db } from './db';
import { sql } from 'kysely';
import { ExportWorker } from './export/jobs/ExportWorker';
import { ExportScheduler } from './export/jobs/ExportScheduler';
import { ShiftBoundaryScheduler } from './jobs/ShiftBoundaryScheduler';
import { checkElasticHealth } from './elastic/elasticClient';
import { ensureIndex } from './elastic/traceabilityIndex';

import { contextMiddleware } from './middleware/contextMiddleware';
import { validateAuthConfigAtStartup } from './config/authConfig';

validateAuthConfigAtStartup();

const app = express();
const port = process.env.PORT || 3005;

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : undefined;
app.use(cors(corsOrigins ? { origin: corsOrigins, credentials: true } : {}));
app.use(express.json());

app.use(contextMiddleware);

app.use('/auth', authRoutes);
app.use('/device', deviceRoutes);
app.use('/planned-coils', plannedCoilRoutes);
app.use('/6hi', SixHiRoutes);
app.use('/live', liveRoutes);
app.use('/machines', machineRoutes);
app.use('/machine-access', machineAccessRoutes);
app.use('/machines/handover', machineHandoverRoutes);
app.use('/shifts', shiftRoutes);
app.use('/shift-logs', shiftLogRoutes);
app.use('/stoppages', stoppageRoutes);
app.use('/crew', crewRoutes);
app.use('/defects', defectRoutes);
app.use('/import', importRoutes);
app.use('/master-data', masterDataRoutes);
app.use('/users', userRoutes);
app.use('/reports', reportRoutes);
app.use('/exports', exportRoutes);
app.use('/traceability', traceabilityRoutes);
app.use('/validation-rules', validationRulesRoutes);
app.use('/api/v1/validation-rules', validationRulesRoutes); // Mount for either convention
app.use('/audit', auditRoutes);
app.get('/health', async (_req, res) => {
  const payload: Record<string, unknown> = {
    status: 'ok',
    service: 'm1-digital-data-collection',
  };
  try {
    await sql`SELECT 1`.execute(db);
    payload.database = 'ok';
  } catch {
    payload.status = 'degraded';
    payload.database = 'unavailable';
    res.status(503).json(payload);
    return;
  }
  res.json(payload);
});

import { rfc7807ErrorHandler } from './middleware/errorMiddleware';
import { DefaultRuleSeeder } from './services/DefaultRuleSeeder';

app.use(rfc7807ErrorHandler);

const server = app.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
  
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

function shutdown(signal: string) {
  console.log(`[shutdown] ${signal} received — stopping background workers`);
  ExportWorker.stop();
  ExportScheduler.stop();
  ShiftBoundaryScheduler.stop();
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
