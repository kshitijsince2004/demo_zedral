import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { logAuthorizationDenied } from '../auth/authorizationAudit';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { ChangeRequestService } from '../services/ChangeRequestService';
import { db } from '../db';

function denyPlantHeadChangeRequestAction(
  req: import('express').Request,
  res: import('express').Response,
  operation: string,
): boolean {
  if (!req.user?.roles.includes(UserRole.PLANT_HEAD as string)) return false;
  void logAuthorizationDenied(req.user.id, UserRole.PLANT_HEAD, operation, 'change_request');
  res.status(403).json({
    error: 'AUTHORIZATION_DENIED',
    message: 'Plant Head has read-only access. Change request actions are not permitted.',
    role: UserRole.PLANT_HEAD,
    operation,
  });
  return true;
}

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const shiftLogId = req.query.shiftLogId as string | undefined;
    const canViewAll = req.user!.roles.some((r) =>
      ([UserRole.SUPERVISOR, UserRole.ADMIN, UserRole.PLANT_HEAD] as string[]).includes(r)
    );

    let query = db
      .selectFrom('audit.change_request as cr')
      .leftJoin('security.app_user as u', 'cr.requested_by', 'u.user_id')
      .select([
        'cr.cr_id',
        'cr.table_name',
        'cr.record_pk',
        'cr.reason',
        'cr.state',
        'cr.requested_at',
        'cr.decided_at',
        'cr.proposed_changes',
        'cr.rejection_note',
        'u.full_name as requestedByName',
      ])
      .orderBy('cr.requested_at', 'desc');

    if (shiftLogId) {
      query = query
        .where('cr.table_name', '=', 'txn.shift_log')
        .where('cr.record_pk', '=', String(shiftLogId));
    } else if (!canViewAll) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const rows = await query.execute();
    res.json(rows.map((row) => ChangeRequestService.mapListRow(row)));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  if (denyPlantHeadChangeRequestAction(req, res, 'CHANGE_REQUEST_CREATE')) return;
  try {
    const created = await ChangeRequestService.create(req.body, String(req.user!.id));
    res.status(201).json(created);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id/approve', async (req, res) => {
  if (denyPlantHeadChangeRequestAction(req, res, 'CHANGE_REQUEST_APPROVE')) return;
  if (!req.user!.roles.some((r) => r === UserRole.SUPERVISOR || r === UserRole.ADMIN)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const updated = await ChangeRequestService.approve(req.params.id, String(req.user!.id));
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id/reject', async (req, res) => {
  if (denyPlantHeadChangeRequestAction(req, res, 'CHANGE_REQUEST_REJECT')) return;
  if (!req.user!.roles.some((r) => r === UserRole.SUPERVISOR || r === UserRole.ADMIN)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const updated = await ChangeRequestService.reject(
      req.params.id,
      String(req.user!.id),
      req.body.remarks ?? req.body.rejectionNote
    );
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** Client-compatible PATCH handler (ChangeRequestPanel uses PATCH). */
router.patch('/:id', async (req, res) => {
  if (denyPlantHeadChangeRequestAction(req, res, 'CHANGE_REQUEST_EDIT')) return;
  if (!req.user!.roles.some((r) => r === UserRole.SUPERVISOR || r === UserRole.ADMIN)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { action, rejectionNote } = req.body;
    if (action === 'APPROVE') {
      const updated = await ChangeRequestService.approve(req.params.id, String(req.user!.id));
      return res.json(updated);
    }
    if (action === 'REJECT') {
      const updated = await ChangeRequestService.reject(
        req.params.id,
        String(req.user!.id),
        rejectionNote
      );
      return res.json(updated);
    }
    res.status(400).json({ error: 'action must be APPROVE or REJECT' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
