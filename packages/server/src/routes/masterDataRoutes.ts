import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { MasterDataService } from '../services/MasterDataService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

// Whitelist of allowed master data tables to prevent SQL injection or un-authorized table access
const ENTITY_CONFIG: Record<string, { table: string, pk: string }> = {
  'customers': { table: 'master.customer', pk: 'customer_id' },
  'grades': { table: 'master.grade', pk: 'grade_code' },
  'surface_finishes': { table: 'master.surface_finish', pk: 'surface_finish' },
  'defect_codes': { table: 'master.defect_code', pk: 'defect_code' },
  'stoppage_categories': { table: 'master.stoppage_category', pk: 'category_code' },
  'stoppage_codes': { table: 'master.stoppage_code', pk: 'stoppage_code' },
  'operators': { table: 'master.operator', pk: 'operator_id' },
  'furnaces': { table: 'master.furnace', pk: 'furnace_id' }
};

const validateTable = (req: any, res: any, next: any) => {
  const config = ENTITY_CONFIG[req.params.entityType];
  if (!config) {
    return res.status(400).json({ error: 'Invalid master data entity type' });
  }
  req.tableName = config.table;
  req.pkColumn = config.pk;
  next();
};

router.get('/delta', async (_req, res) => {
  try {
    const rows = (
      await Promise.all(
        Object.entries(ENTITY_CONFIG).map(async ([entityType, config]) => {
          const records = await MasterDataService.getAll(config.table, false);
          return records.map((record: Record<string, unknown>) => ({
            ...record,
            tableName: entityType,
          }));
        }),
      )
    ).flat();

    res.json({ rows, serverTime: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Task 12.2 Grade Specs ---
router.post('/grade-specs', requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const id = await MasterDataService.createGradeSpec(req.body);
    res.status(201).json({ id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/grade-specs/:gradeCode', async (req, res) => {
  try {
    // customerId passed as query param if applicable
    const spec = await MasterDataService.getGradeSpec(req.params.gradeCode, req.query.customerId as string);
    if (!spec) return res.status(404).json({ error: 'Grade spec not found' });
    res.json(spec);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// --- Task 12.1 Generic CRUD ---

router.get('/:entityType', validateTable, async (req: any, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const data = await MasterDataService.getAll(req.tableName, includeInactive);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:entityType', requireRole([UserRole.ADMIN]), validateTable, async (req: any, res) => {
  try {
    const id = await MasterDataService.create(req.tableName, req.pkColumn, req.body);
    res.status(201).json({ id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/:entityType/:id', requireRole([UserRole.ADMIN]), validateTable, async (req: any, res) => {
  try {
    await MasterDataService.update(req.tableName, req.pkColumn, req.params.id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:entityType/:id', requireRole([UserRole.ADMIN]), validateTable, async (req: any, res) => {
  try {
    await MasterDataService.deactivate(req.tableName, req.pkColumn, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
