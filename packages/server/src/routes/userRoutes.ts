import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { UserService } from '../services/UserService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);
router.use(requireRole([UserRole.ADMIN, UserRole.PLANT_HEAD]));

function mapClientPayload(body: any) {
  return {
    username: body.username,
    display_name: body.display_name ?? body.displayName,
    role: body.role,
    status: body.status,
    emp_code: body.emp_code ?? body.empCode,
    pin: body.pin,
    line_access: body.line_access ?? body.lineAccess ?? [],
    machine_access: body.machine_access ?? body.machineAccess,
    email: body.email,
    password: body.password,
  };
}

router.get('/', async (_req, res) => {
  try {
    const users = await UserService.list();
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await UserService.getById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const created = await UserService.create(mapClientPayload(req.body), req.user!.id);
    res.status(201).json(created);
  } catch (error: any) {
    const status = error.message?.includes('unique') ? 409 : 400;
    console.error("USER_UPDATE_ERR", error); 
    res.status(status).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updated = await UserService.update(req.params.id, mapClientPayload(req.body), req.user!.id);
    res.json(updated);
  } catch (error: any) {
    const status = error.message === 'User not found' ? 404 : 400;
    console.error("USER_UPDATE_ERR", error);
    res.status(status).json({ error: error.message });
  }
});

router.put('/:id/line-access', async (req, res) => {
  try {
    const lineAccess = req.body.line_access ?? req.body.lineAccess ?? [];
    const updated = await UserService.updateLineAccess(req.params.id, lineAccess);
    res.json(updated);
  } catch (error: any) {
    const status = error.message === 'User not found' ? 404 : 400;
    console.error("USER_UPDATE_ERR", error);
    res.status(status).json({ error: error.message });
  }
});

export default router;
