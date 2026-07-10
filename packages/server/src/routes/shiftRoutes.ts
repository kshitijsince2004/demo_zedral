import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { ShiftDetectionService, type ShiftOverrideReason } from '../services/ShiftDetectionService';

const router = Router();
router.use(requireAuth);

router.get('/current', async (req, res) => {
  try {
    const machineCode = typeof req.query.machine === 'string' ? req.query.machine : undefined;
    const shift = await ShiftDetectionService.getCurrentShift({
      userId: req.user!.id,
      machineCode,
    });
    res.json(shift);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to detect shift';
    res.status(500).json({ error: message });
  }
});

router.get('/windows', async (_req, res) => {
  try {
    const windows = await ShiftDetectionService.listShiftWindows();
    res.json({ windows, timezone: 'Asia/Kolkata' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load shift windows';
    res.status(500).json({ error: message });
  }
});

router.post('/override', requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const {
      selectedShiftCode,
      prodDate,
      reasonCode,
      reasonDetail,
      machineCode,
      confirm,
    } = req.body ?? {};

    if (!confirm) {
      return res.status(400).json({ error: 'Confirmation required for shift override' });
    }
    if (!selectedShiftCode || !prodDate || !reasonCode) {
      return res.status(400).json({ error: 'selectedShiftCode, prodDate, and reasonCode are required' });
    }

    const validReasons: ShiftOverrideReason[] = [
      'OVERTIME',
      'PREV_SHIFT_CONTINUATION',
      'SUPERVISOR_INSTRUCTION',
      'SHIFT_CORRECTION',
      'OTHER',
    ];
    if (!validReasons.includes(reasonCode)) {
      return res.status(400).json({ error: `Invalid reasonCode: ${reasonCode}` });
    }

    const shift = await ShiftDetectionService.recordOverride({
      userId: req.user!.id,
      selectedShiftCode: String(selectedShiftCode).toUpperCase(),
      prodDate: String(prodDate),
      reasonCode,
      reasonDetail: reasonDetail ? String(reasonDetail) : undefined,
      machineCode: machineCode ? String(machineCode).toUpperCase() : undefined,
    });

    res.json(shift);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to record shift override';
    res.status(400).json({ error: message });
  }
});

router.put('/windows/:shiftCode', requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const { startTime, endTime } = req.body ?? {};
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime and endTime are required (HH:MM)' });
    }
    const windows = await ShiftDetectionService.updateShiftWindow(
      String(req.params.shiftCode),
      String(startTime),
      String(endTime),
      req.user!.id,
    );
    res.json({ windows, timezone: 'Asia/Kolkata' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update shift window';
    res.status(400).json({ error: message });
  }
});

router.get('/audit', requireRole([UserRole.ADMIN, UserRole.PLANT_HEAD, UserRole.SUPERVISOR]), async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : undefined;
    const events = await ShiftDetectionService.listShiftAudit({ limit, eventType });
    res.json({ events });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load shift audit';
    res.status(500).json({ error: message });
  }
});

export default router;
