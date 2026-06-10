import { Router } from 'express';
import {
  AuthError,
  ServiceUnavailableError,
  exchangeOidcCode,
  generateTokens,
  isDbConnectionError,
  validateBadgePin,
  verifyToken,
  getUserWithRolesAndAccess,
} from '../services/authService';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
import { db } from '../db';

const router = Router();

// Used by express to parse JSON bodies
router.use(require('express').json());

router.post('/token', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Missing OIDC code' });
    }

    const user = await exchangeOidcCode(code);
    const tokens = generateTokens(user);

    res.json(tokens);
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Authentication failed' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    // Verify refresh token validity
    const decoded = verifyToken(refreshToken);
    
    // Look up user again
    const user = await db.selectFrom('security.app_user')
      .select(['user_id', 'username'])
      .where('user_id', '=', Number(decoded.id))
      .where('status', 'in', ['ACTIVE', 'LOCKED'])
      .executeTakeFirst();
      
    if (!user) throw new Error('User not found');

    const freshUser = await getUserWithRolesAndAccess(user.user_id, user.username);
    const tokens = generateTokens(freshUser);

    res.json(tokens);
  } catch (error: any) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

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
    const tokens = generateTokens(user);

    res.json(tokens);
  } catch (error: unknown) {
    authRouteError(res, error);
  }
});

export default router;
