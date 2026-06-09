import { Router, Request, Response } from 'express';
import { requireAuth, requireLineAccess } from '../middleware/authMiddleware';
import { validateProcessEntry } from '@m1/shared-validation';
import {
  HRSService,
  PKLService,
  CRMService,
  ANNService,
  SKPService,
  RWDService,
  CRSService,
  CTLService,
  GLVService
} from '../services/processServices';
import { domainEvents } from '../services/DomainEventPublisher';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

/**
 * Unified entry capture endpoint
 * POST /entries/:processId
 * Validates payload generically using shared-validation schema mapped to processId,
 * then delegates to process-specific service for custom DB logic.
 */
router.post('/:processId', requireLineAccess('WRITE'), async (req: Request, res: Response) => {
  const { processId } = req.params;
  const upperProcessId = processId.toUpperCase();

  try {
      // 2. Validate payload using shared Zod schemas
      const validationResult = validateProcessEntry(upperProcessId, req.body);
      if (!validationResult.isValid && validationResult.errors.some(e => e.severity === 'BLOCK')) {
        return res.status(400).json({ validationResult });
      }

      // 3. Delegate to specific service
      let entryId: string;
      const shiftLogId = req.body.shiftLogId; // Assuming shiftLogId is passed in payload
      const userId = String(req.user!.id);
      
      switch (upperProcessId) {
        case 'HRS':
          entryId = await HRSService.createEntry(shiftLogId, req.body, userId);
          break;
        case 'PKL':
          entryId = await PKLService.createEntry(shiftLogId, req.body, userId);
          break;
        case 'PKL_CHART':
          entryId = await PKLService.createChartEntry(shiftLogId, req.body, userId);
          break;
        case 'CRM':
          entryId = await CRMService.createEntry(shiftLogId, req.body, userId);
          break;
        case 'ANN':
          entryId = await ANNService.createEntry(shiftLogId, req.body, userId);
          break;
        case 'SKP':
          entryId = await SKPService.createEntry(shiftLogId, req.body, userId);
          break;
        case 'RWD':
          entryId = await RWDService.createEntry(shiftLogId, req.body, userId);
          break;
        case 'CRS':
          entryId = await CRSService.createEntry(shiftLogId, req.body, userId);
          break;
        case 'CTL':
          entryId = await CTLService.createEntry(shiftLogId, req.body, userId);
          break;
        case 'GLV':
          entryId = await GLVService.createEntry(shiftLogId, req.body, userId);
          break;
        default:
          return res.status(400).json({ message: `Unknown process type: ${upperProcessId}` });
      }

      // 4. Publish Domain Event
      domainEvents.publish('ENTRY_SAVED', { entryId, processId: upperProcessId, shiftLogId, userId });

      res.status(201).json({ id: entryId, validationResult });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
});

export default router;
