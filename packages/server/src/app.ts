import express from 'express';
import cors from 'cors';
import supertokens from 'supertokens-node';
import Session from 'supertokens-node/recipe/session';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import { middleware as stMiddleware, errorHandler as stErrorHandler } from 'supertokens-node/framework/express';
import { getSuperTokensConfig } from './config/authConfig';
import { getAuthUserBySuperTokensId } from './services/authService';

import authRoutes from './routes/authRoutes';
import shiftLogRoutes from './routes/shiftLogRoutes';
import shiftRoutes from './routes/shiftRoutes';
import stoppageRoutes from './routes/stoppageRoutes';
import crewRoutes from './routes/crewRoutes';
import machineCrewRoutes from './routes/machineCrewRoutes';
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
import canonRoutes from './routes/canonRoutes';
import productionRoutes from './modules/m1-collection/routes/productionRoutes';
import { db } from './db';
import { contextMiddleware } from './middleware/contextMiddleware';
import { tenantScopeMiddleware } from './middleware/tenantScopeMiddleware';
import { idempotencyMiddleware } from './middleware/idempotencyMiddleware';
import { rfc7807ErrorHandler } from './middleware/errorMiddleware';
import { getTenantModuleConfig } from './platform/tenantConfig';
import { sql } from 'kysely';
import { ModuleRegistry, requireModule } from '@zedral/platform';
import { m1ManifestMeta } from '@zedral/m1-collection';
export interface ComposedApp {
  app: express.Express;
  registry: ModuleRegistry;
}

export function buildApp(registry: ModuleRegistry): ComposedApp {
  const app = express();

  const configured = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];
  // Capacitor operator APK WebView origin (always allow when CORS is restricted).
  const capacitorOrigins = ['https://localhost', 'capacitor://localhost', 'http://localhost'];
  const corsOrigins =
    configured.length > 0 ? [...new Set([...configured, ...capacitorOrigins])] : capacitorOrigins;
  
  const stConfig = getSuperTokensConfig();
  supertokens.init({
    framework: 'express',
    supertokens: {
      connectionURI: stConfig.connectionURI,
      apiKey: stConfig.apiKey,
    },
    appInfo: {
      appName: 'Zedral M1',
      apiDomain: stConfig.apiDomain,
      websiteDomain: stConfig.websiteDomain,
      apiBasePath: '/auth',
      websiteBasePath: '/login',
    },
    recipeList: [
      EmailPassword.init(),
      Session.init({
        override: {
          functions: (originalImplementation) => {
            return {
              ...originalImplementation,
              createNewSession: async function (input) {
                const user = await getAuthUserBySuperTokensId(input.userId);
                if (user) {
                  input.accessTokenPayload = {
                    ...input.accessTokenPayload,
                    id: user.id,
                    username: user.username,
                    roles: user.roles,
                    lineAccess: user.lineAccess,
                    lineScopes: user.lineScopes,
                    machineAccess: user.machineAccess,
                  };
                }
                const existing = await Session.getAllSessionHandlesForUser(input.userId);
                const newSession = await originalImplementation.createNewSession(input);
                await Promise.all(existing.map((h) => Session.revokeSession(h)));
                return newSession;
              }
            };
          }
        }
      })
    ]
  });

  app.use(cors({
    origin: corsOrigins
      // Explicit allow-list when CORS_ORIGIN is configured
      ? corsOrigins
      // Fallback: echo the request origin (safe for dev, never sends '*' with credentials)
      : (origin, callback) => callback(null, origin || true),
    credentials: true,
    allowedHeaders: ['content-type', ...supertokens.getAllCORSHeaders()],
  }));
  app.use(express.json());

  app.use(contextMiddleware);
  app.use(tenantScopeMiddleware);

  const m1Guard = requireModule('M1', m1ManifestMeta.featureFlag, getTenantModuleConfig);

  app.use(stMiddleware());
  app.use('/auth', authRoutes);
  app.use('/v1/canon', canonRoutes);
  app.use(
    [
      '/shift-logs',
      '/stoppages',
      '/defects',
      '/crew',
      '/production',
      '/6hi',
      '/machines/handover',
    ],
    idempotencyMiddleware,
  );
  app.use('/device', m1Guard, deviceRoutes);
  app.use('/planned-coils', m1Guard, plannedCoilRoutes);
  app.use('/6hi', m1Guard, SixHiRoutes);
  app.use('/live', m1Guard, liveRoutes);
  app.use('/machines', m1Guard, machineRoutes);
  app.use('/machine-access', m1Guard, machineAccessRoutes);
  app.use('/machines/handover', m1Guard, machineHandoverRoutes);
  app.use('/shifts', m1Guard, shiftRoutes);
  app.use('/shift-logs', m1Guard, shiftLogRoutes);
  app.use('/stoppages', m1Guard, stoppageRoutes);
  app.use('/crew', m1Guard, crewRoutes);
  app.use('/machine-crew', m1Guard, machineCrewRoutes);
  app.use('/defects', m1Guard, defectRoutes);
  app.use('/import', m1Guard, importRoutes);
  app.use('/master-data', m1Guard, masterDataRoutes);
  app.use('/users', m1Guard, userRoutes);
  app.use('/reports', m1Guard, reportRoutes);
  app.use('/exports', m1Guard, exportRoutes);
  app.use('/traceability', m1Guard, traceabilityRoutes);
  app.use('/validation-rules', m1Guard, validationRulesRoutes);
  app.use('/api/v1/validation-rules', m1Guard, validationRulesRoutes);
  app.use('/audit', m1Guard, auditRoutes);
  app.use('/production', m1Guard, productionRoutes);

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

  app.use(stErrorHandler());
  app.use(rfc7807ErrorHandler);
  return { app, registry };
}
