import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import validationRulesRoutes from '../../src/routes/validationRulesRoutes';
import { db } from '../../src/db';
import { FIELD_REGISTRY } from '@m1/shared-validation';
import { ValidationConfigService } from '../../src/services/ValidationConfigService';

// Mock authentication middleware — AuthUser uses roles[] (not singular role)
vi.mock('../../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.user) {
      req.user = { id: 1, roles: ['ADMIN'], username: 'test_admin' };
    }
    next();
  },
  requireRole: (roles: string[]) => {
    return (req: any, res: any, next: any) => {
      const userRoles: string[] = req.user?.roles ?? [];
      if (!req.user || (!userRoles.some((r) => roles.includes(r)) && !userRoles.includes('ADMIN'))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    };
  }
}));

describe('ValidationConfigService Integration Tests', () => {
  let app: express.Application;
  let service: ValidationConfigService;
  
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    // Inject mock user middleware before routes
    app.use((req: any, res: any, next: any) => {
      const role = req.headers['x-mock-role'];
      if (typeof role === 'string' && role.length > 0) {
        req.user = {
          id: 2,
          roles: [role],
          username: `test_${role}`,
        };
      }
      next();
    });
    app.use('/validation-rules', validationRulesRoutes);
    
    service = new ValidationConfigService(db);

    // Ensure trigger only — do not replace audit.fn_audit (shared DB / migrations own it).
    const { sql } = await import('kysely');
    await db.executeQuery(
      sql`
        DROP TRIGGER IF EXISTS trg_audit_validation_rule ON config.validation_rule;
        CREATE TRIGGER trg_audit_validation_rule
        AFTER INSERT OR UPDATE OR DELETE ON config.validation_rule
        FOR EACH ROW EXECUTE FUNCTION audit.fn_audit();
      `.compile(db)
    ).catch(() => {});
  });

  beforeEach(async () => {
    await db.deleteFrom('config.validation_rule').execute();
  });

  it('8.2 Authorization Matrix: Only ADMIN can configure rules', async () => {
    const fieldId = FIELD_REGISTRY[0].fieldId;
    const ruleData = { type: 'MANDATORY', severity: 'WARN', isActive: true, params: { mandatory: true } };

    // 1. Operator should be forbidden
    const resOperator = await request(app)
      .post('/validation-rules')
      .set('x-mock-role', 'OPERATOR')
      .send({ fieldId, ...ruleData });
    expect(resOperator.status).toBe(403);

    // 2. MachineHead should be forbidden
    const resMachineHead = await request(app)
      .post('/validation-rules')
      .set('x-mock-role', 'MACHINE_HEAD')
      .send({ fieldId, ...ruleData });
    expect(resMachineHead.status).toBe(403);
    
    // 3. Plant Head should be forbidden (only ADMIN allowed by route definition)
    const resPlantHead = await request(app)
      .post('/validation-rules')
      .set('x-mock-role', 'PLANT_HEAD')
      .send({ fieldId, ...ruleData });
    expect(resPlantHead.status).toBe(403);

    // 4. Admin should succeed
    const resAdmin = await request(app)
      .post('/validation-rules')
      .set('x-mock-role', 'ADMIN')
      .send({ fieldId, ...ruleData });
    expect(resAdmin.status).toBe(200);
  });

  it('7.7 Atomicity and audit capture', async () => {
    const fieldId = FIELD_REGISTRY[0].fieldId;
    const ruleData = { type: 'RANGE', severity: 'BLOCK', isActive: true, params: { min: 10, max: 20 } };

    const initialHistory = await service.getFieldHistory(fieldId);
    const beforeCount = initialHistory.length;

    const res = await request(app)
      .post('/validation-rules')
      .set('x-mock-role', 'ADMIN')
      .send({ fieldId, ...ruleData });
      
    expect(res.status).toBe(200);

    // Fetch the rule directly
    const rules = await service.getConfiguredRules();
    const dbRule = rules.find(r => r.fieldId === fieldId);
    expect(dbRule).toBeDefined();
    expect(dbRule?.type).toBe('RANGE');

    // Verify audit log captured the transaction atomically
    const history = await service.getFieldHistory(fieldId);
    expect(history.length).toBe(beforeCount + 1);
    
    const latestAudit = history[0];
    expect(latestAudit.action).toBe('INSERT'); // or UPDATE if previously seeded
    const newValue = JSON.parse(latestAudit.new_value);
    expect(newValue.rule_type).toBe('RANGE');
    expect(newValue.severity).toBe('BLOCK');
  });
});
