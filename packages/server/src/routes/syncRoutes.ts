import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { assertLineWriteAccess } from '../services/authService';
import {
  HRSService, PKLService, CRMService,
  ANNService, SKPService, RWDService,
  CRSService, CTLService, GLVService
} from '../services/processServices';
import { StoppageService, CrewService, DefectService } from '../services/ancillaryServices';
import { domainEvents } from '../services/DomainEventPublisher';
import { parseProcessCodeFromEntryUrl } from '../utils/entryUrl';

const router = Router();
router.use(requireAuth);

// Dispatch map for process entries
const processDispatch: Record<string, any> = {
  'HRS': HRSService.createEntry,
  'PKL': PKLService.createEntry,
  'PKL_CHART': PKLService.createChartEntry,
  'CRM': CRMService.createEntry,
  'ANN': ANNService.createEntry,
  'SKP': SKPService.createEntry,
  'RWD': RWDService.createEntry,
  'CRS': CRSService.createEntry,
  'CTL': CTLService.createEntry,
  'GLV': GLVService.createEntry
};

type SyncKind = 'entry' | 'stoppage' | 'defect' | 'crew' | 'unsupported';

function resolveSyncKind(url: string): SyncKind {
  const path = url.split('?')[0].toLowerCase();
  if (path.includes('/entries/defect')) return 'defect';
  if (path.includes('/entries/stoppage')) return 'stoppage';
  if (path.includes('/entries/crew')) return 'crew';
  if (path.endsWith('/defects') || path.includes('/defects/')) return 'defect';
  if (path.endsWith('/stoppages') || path.includes('/stoppages/')) return 'stoppage';
  if (path.endsWith('/crew') || path.includes('/crew/')) return 'crew';
  if (path.includes('/entries')) return 'entry';
  return 'unsupported';
}

router.post('/batch', async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Expected items array' });
  }

  const results = [];
  const userId = String(req.user!.id);

  for (const item of items) {
    const { timestamp } = item;
    try {
      const { method, url, payload } = item;

      if (method !== 'POST') {
        throw new Error(`Unsupported sync method: ${method}`);
      }

      const kind = resolveSyncKind(url);

      if (kind === 'entry') {
        const processCode =
          (payload?.processCode as string | undefined)?.toUpperCase() ||
          parseProcessCodeFromEntryUrl(url);

        if (!processCode) {
          throw new Error(`Could not resolve process code from sync URL: ${url}`);
        }

        assertLineWriteAccess(req.user!, processCode);

        const handler = processDispatch[processCode];

        if (!handler) {
          throw new Error(`No handler for process code: ${processCode}`);
        }

        const entryId = await handler(payload.shiftLogId, payload, userId);

        domainEvents.publish('ENTRY_SYNCED', { entryId, payload, processCode });
        results.push({ timestamp, status: 'SUCCESS', id: entryId });
      } else if (kind === 'stoppage') {
        const id = await StoppageService.create(payload, userId);
        results.push({ timestamp, status: 'SUCCESS', id });
      } else if (kind === 'defect') {
        const id = await DefectService.create(payload, userId);
        results.push({ timestamp, status: 'SUCCESS', id });
      } else if (kind === 'crew') {
        const id = await CrewService.create(payload);
        results.push({ timestamp, status: 'SUCCESS', id });
      } else {
        throw new Error(`Unsupported sync URL: ${url}`);
      }
    } catch (err: any) {
      results.push({ timestamp: item.timestamp, status: 'CONFLICT', error: err.message });
    }
  }

  res.json({ processed: items.length, results });
});

export default router;
