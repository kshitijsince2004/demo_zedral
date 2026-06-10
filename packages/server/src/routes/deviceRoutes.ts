import { Router } from 'express';
import { DeviceRegistrationService } from '../services/DeviceRegistrationService';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();
router.use(require('express').json());

router.post('/register', rateLimitMiddleware(10, 60_000), async (req, res) => {
  try {
    const { processCode } = req.body;
    if (!processCode) {
      return res.status(400).json({ error: 'processCode is required' });
    }
    const deviceId = await DeviceRegistrationService.registerDevice(processCode);
    res.status(201).json({ deviceId, processCode });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/status/:processCode', requireAuth, async (req, res) => {
  try {
    const device = await DeviceRegistrationService.getDeviceByProcess(req.params.processCode);
    if (!device) {
      return res.status(404).json({ error: 'Device not found for this process' });
    }
    res.json({ deviceId: device.device_id, processCode: device.process_code, status: 'ACTIVE' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
