import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes';
import shiftLogRoutes from './routes/shiftLogRoutes';
import shiftRoutes from './routes/shiftRoutes';
import entriesRoutes from './routes/entriesRoutes';
import stoppageRoutes from './routes/stoppageRoutes';
import crewRoutes from './routes/crewRoutes';
import defectRoutes from './routes/defectRoutes';
import autoSourceRoutes from './routes/autoSourceRoutes';
import changeRequestRoutes from './routes/changeRequestRoutes';
import shiftHandoverRoutes from './routes/shiftHandoverRoutes';
import importRoutes from './routes/importRoutes';
import masterDataRoutes from './routes/masterDataRoutes';
import userRoutes from './routes/userRoutes';
import exportRoutes from './routes/exportRoutes';
import reportRoutes from './routes/reportRoutes';
import syncRoutes from './routes/syncRoutes';
import validationRulesRoutes from './routes/validationRulesRoutes';
import deviceRoutes from './routes/deviceRoutes';
import traceabilityRoutes from './routes/traceabilityRoutes';
import plannedCoilRoutes from './routes/plannedCoilRoutes';
import SixHiRoutes from './routes/sixHiRoutes';
import liveRoutes from './routes/liveRoutes';
import machineAccessRoutes from './routes/machineAccessRoutes';
import machineHandoverRoutes from './routes/machineHandoverRoutes';
import auditRoutes from './routes/auditRoutes';
import { db } from './db';
import { ExportScheduler } from './export/jobs/ExportScheduler';
import { ExportWorker } from './export/jobs/ExportWorker';
import { ShiftBoundaryScheduler } from './jobs/ShiftBoundaryScheduler';

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
app.use('/machine-access', machineAccessRoutes);
app.use('/machines/handover', machineHandoverRoutes);
app.use('/shifts', shiftRoutes);
app.use('/shift-logs', shiftLogRoutes);
app.use('/entries', entriesRoutes);
app.use('/stoppages', stoppageRoutes);
app.use('/crew', crewRoutes);
app.use('/defects', defectRoutes);
app.use('/auto-source', autoSourceRoutes);
app.use('/change-requests', changeRequestRoutes);
app.use('/handovers', shiftHandoverRoutes);
app.use('/import', importRoutes);
app.use('/master-data', masterDataRoutes);
app.use('/users', userRoutes);
app.use('/reports', reportRoutes);
app.use('/exports', exportRoutes);
app.use('/traceability', traceabilityRoutes);
app.use('/sync', syncRoutes);
app.use('/validation-rules', validationRulesRoutes);
app.use('/api/v1/validation-rules', validationRulesRoutes); // Mount for either convention
app.use('/audit', auditRoutes);
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'm1-digital-data-collection' });
});

import { rfc7807ErrorHandler } from './middleware/errorMiddleware';
import { DefaultRuleSeeder } from './services/DefaultRuleSeeder';

app.use(rfc7807ErrorHandler);

app.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
  
  // Seed validation rules
  const seeder = new DefaultRuleSeeder(db);
  await seeder.seed().catch(err => {
    console.error('Failed to seed validation rules:', err);
  });
  
  ExportWorker.start();
  ExportScheduler.start();
  ShiftBoundaryScheduler.start();
});
