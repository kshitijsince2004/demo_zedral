import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';

export const dprRoutes = Router();

dprRoutes.use(requireAuth);

dprRoutes.post('/templates', (_req, res) => res.json({ id: 'stub' }));
dprRoutes.post('/months', (_req, res) => res.json({ id: 'stub' }));
dprRoutes.post('/months/:id/entries', (_req, res) => res.json({ status: 'saved' }));
dprRoutes.post('/months/:id/export', (_req, res) => res.json({ status: 'exported' }));
dprRoutes.get('/source-map', (_req, res) => res.json([]));
