import { Router } from 'express';
import {
  AuthError,
  ServiceUnavailableError,
  isDbConnectionError,
  validateBadgePin,
  verifyAuthenticatedUserPin,
  verifySupervisorOverridePin,
} from '../services/authService';
import Session from 'supertokens-node/recipe/session';
import supertokens from 'supertokens-node';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
import { requireAuth } from '../middleware/authMiddleware';
import { AuditTrailService } from '../services/AuditTrailService';
import { db } from '../db';

const router = Router();

// Used by express to parse JSON bodies
router.use(require('express').json());

function authRouteError(res: import('express').Response, error: unknown) {
  if (error instanceof AuthError) {
    return res.status(401).json({ error: error.message });
  }
  if (error instanceof ServiceUnavailableError || isDbConnectionError(error)) {
    const message =
      error instanceof Error
        ? error.message
        : 'Database unavailable. Start Docker: docker compose up -d db-primary';
    return res.status(503).json({ error: message });
  }
  const message = error instanceof Error ? error.message : 'Authentication failed';
  return res.status(500).json({ error: message });
}

router.post('/badge-pin', rateLimitMiddleware(20, 60_000), async (req, res) => {
  try {
    const { badgeId, pin } = req.body;
    if (!badgeId || !pin) {
      return res.status(400).json({ error: 'Missing badge ID or PIN' });
    }

    const user = await validateBadgePin(badgeId, pin);
    const stUserId = supertokens.convertToRecipeUserId(String(user.id));
    await Session.createNewSession(req, res, 'public', stUserId, {
      id: user.id,
      username: user.username,
      roles: user.roles,
      lineAccess: user.lineAccess,
      lineScopes: user.lineScopes,
      machineAccess: user.machineAccess,
    });

    res.json({ ok: true });
  } catch (error: unknown) {
    authRouteError(res, error);
  }
});

/** Screen unlock — verifies the authenticated user's own PIN. */
router.post('/verify-pin', requireAuth, rateLimitMiddleware(10, 60_000), async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({ error: 'PIN is required' });
    }

    await verifyAuthenticatedUserPin(req.user!.id, pin);
    res.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return res.status(401).json({ error: error.message });
    }
    return res.status(500).json({ error: 'PIN verification failed' });
  }
});

/** Supervisor field override — verifies a supervisor/admin PIN server-side. */
router.post(
  '/supervisor-override',
  requireAuth,
  rateLimitMiddleware(10, 60_000),
  async (req, res) => {
    try {
      const { pin, fieldLabel } = req.body;
      if (!pin || typeof pin !== 'string') {
        return res.status(400).json({ error: 'PIN is required' });
      }

      const supervisor = await verifySupervisorOverridePin(pin);

      await AuditTrailService.log(
        'auth.supervisor_override',
        String(req.user!.id),
        'INSERT',
        null,
        {
          fieldLabel: fieldLabel ?? 'unknown',
          operatorId: req.user!.id,
          supervisorId: supervisor.userId,
          supervisorUsername: supervisor.username,
        },
        req.user!.id,
      );

      res.json({ ok: true, supervisorUsername: supervisor.username });
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        return res.status(401).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Supervisor override verification failed' });
    }
  },
);

export default router;
