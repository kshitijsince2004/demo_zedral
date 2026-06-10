import { Router } from 'express';

export const dprRoutes = Router();

dprRoutes.post('/templates', (req, res) => res.json({ id: 'stub' }));
dprRoutes.post('/months', (req, res) => res.json({ id: 'stub' }));
dprRoutes.post('/months/:id/entries', (req, res) => res.json({ status: 'saved' }));
dprRoutes.post('/months/:id/export', (req, res) => res.json({ status: 'exported' }));
dprRoutes.get('/source-map', (req, res) => res.json([]));
