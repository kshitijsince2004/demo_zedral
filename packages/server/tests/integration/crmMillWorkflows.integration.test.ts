import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { db } from '../../src/db';
import { UserRole } from '@m1/shared-validation';
import sixHiRoutes from '../../src/routes/sixHiRoutes';
import importRoutes from '../../src/routes/importRoutes';
import shiftLogRoutes from '../../src/routes/shiftLogRoutes';

// Mock authentication middleware
let currentUser: any = null;

vi.mock('@zedral/platform', () => ({
  canonicalWriteback: {
    createProductionCount: vi.fn(),
  },
  getEventBus: vi.fn(() => ({
    publish: vi.fn(),
  })),
  buildEventEnvelope: vi.fn(),
}));

vi.mock('../../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.user) {
      req.user = currentUser || { 
        id: 1, 
        roles: [UserRole.ADMIN], 
        username: 'test_admin',
        lineScopes: [
          { code: '4HI', accessLevel: 'WRITE' },
          { code: '6HI', accessLevel: 'WRITE' }
        ],
        machineAccess: ['4HI', '2HI', '6HI']
      };
    }
    next();
  },
  requireRole: (roles: UserRole[]) => {
    return (req: any, res: any, next: any) => {
      if (!req.user || (!req.user.roles.some((r: any) => roles.includes(r)) && !req.user.roles.includes('ADMIN'))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    };
  },
  requireLineAccess: () => {
    return (req: any, res: any, next: any) => next();
  }
}));

describe('CRM Mills End-to-End Workflow Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    
    app.use('/6hi', sixHiRoutes);
    app.use('/import', importRoutes);
    app.use('/shift-logs', shiftLogRoutes);

    // Initial database setup for testing (if any global data is needed)
    // Make sure '4HI' and '2HI' machines exist in master.machine.
    const machines = await db.selectFrom('master.machine').selectAll().execute();
    if (!machines.find(m => m.machine_code === '4HI')) {
      await db.insertInto('master.machine').values({
        machine_code: '4HI',
        name: '4-High Mill',
        process_code: 'ROLLING',
        department: 'Production',
        machine_type: 'MILL'
      }).execute();
    }
    if (!machines.find(m => m.machine_code === '2HI')) {
      await db.insertInto('master.machine').values({
        machine_code: '2HI',
        name: '2-High Mill',
        process_code: 'ROLLING',
        department: 'Production',
        machine_type: 'MILL'
      }).execute();
    }
  });

  beforeEach(async () => {
    // Clear out data to keep tests isolated.
    await db.deleteFrom('txn.crm_rolling_pass').execute();
    await db.deleteFrom('txn.crm_rolling').execute();
    await db.deleteFrom('txn.crm_skinpass').execute();
    await db.deleteFrom('txn.crm_shift_summary').execute();
    await db.deleteFrom('txn.crm_order').execute();
    await db.deleteFrom('txn.shift_log').execute();
    await db.deleteFrom('planning.queue_handoff').execute();
    await db.deleteFrom('planning.order_journey_step').execute();
    await db.deleteFrom('planning.order_journey').execute();
    await db.deleteFrom('planning.ppc_batch').execute();
  });

  it('should run a complete 4HI production flow', async () => {
    // 1. Setup user as 4HI OPERATOR
    currentUser = {
      id: 2,
      roles: [UserRole.OPERATOR],
      username: 'op_4hi',
      lineScopes: [{ code: '4HI', accessLevel: 'WRITE' }],
      machineAccess: ['4HI']
    };

    // 2. We skip actual PPC file upload for brevity and instead seed an order in DB to act as queue
    // In a true e2e we'd use /import/ppc-orders, but seeding directly simplifies test boundary
    const batchNo = '4HI-BATCH-001';
    await db.insertInto('planning.ppc_batch').values({
      batch_number: batchNo,
      sub_process: 'ROLLING',
      machine_code: '4HI',
      machine_allocated: true,
      coil_no: 'COIL-4001',
      customer_name: 'Acme Corp',
      grade_code: 'CRCA',
      width_mm: 1000,
      input_thk_mm: 2.0,
      ppc_thk_mm: 1.0,
      ppc_weight_mt: 10,
      shift_code: 'A',
      plan_date: new Date('2026-07-12')
    }).execute();

    // 3. Queue check
    let res = await request(app).get('/6hi/queue?machine=4HI');
    expect(res.status).toBe(200);
    expect(res.body.queue.some((o: any) => o.batchNumber === batchNo)).toBe(true);

    // 4. Start order
    res = await request(app).post(`/6hi/orders/${batchNo}/start?machine=4HI`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');

    // 5. Rolling passes (4HI specific)
    res = await request(app).patch(`/6hi/orders/${batchNo}/rolling?machine=4HI`).send({
      passes: [{ passNo: 1, thicknessMm: 1.5 }, { passNo: 2, thicknessMm: 1.0 }],
      totalPasses: 2,
      actualWeightMt: 9.8,
      destination: 'ANNEALING'
    });
    expect(res.status).toBe(200);

    // 6. Skin pass
    res = await request(app).patch(`/6hi/orders/${batchNo}/skinpass?machine=4HI`).send({
      actualWeightMt: 9.8,
      destination: 'ANNEALING',
      defects: []
    });
    expect(res.status).toBe(200);

    // 7. End order
    res = await request(app).post(`/6hi/orders/${batchNo}/end?machine=4HI`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('should run a complete 2HI production flow (Skin pass only)', async () => {
    // 1. Setup user as 2HI OPERATOR
    currentUser = {
      id: 5,
      roles: [UserRole.OPERATOR],
      username: 'op_2hi',
      lineScopes: [{ code: '2HI', accessLevel: 'WRITE' }],
      machineAccess: ['2HI']
    };

    const batchNo = '2HI-BATCH-001';
    await db.insertInto('planning.ppc_batch').values({
      batch_number: batchNo,
      sub_process: 'SKIN_PASS',
      machine_code: '2HI',
      machine_allocated: true,
      coil_no: 'COIL-2001',
      customer_name: 'Beta LLC',
      grade_code: 'CRCA',
      width_mm: 1200,
      input_thk_mm: 1.5,
      ppc_thk_mm: 1.5,
      ppc_weight_mt: 15,
      shift_code: 'C',
      plan_date: new Date('2026-07-12')
    }).execute();

    // 2. Queue check
    let res = await request(app).get('/6hi/queue?machine=2HI&subProcess=SKIN_PASS');
    expect(res.status).toBe(200);
    expect(res.body.queue.some((o: any) => o.batchNumber === batchNo)).toBe(true);

    // 4. Start order
    res = await request(app).post(`/6hi/orders/${batchNo}/start?machine=2HI`).send({});
    expect(res.status).toBe(200);
    
    // 5. 2HI does NOT do rolling passes. Just skin pass.
    res = await request(app).patch(`/6hi/orders/${batchNo}/skinpass?machine=2HI`).send({
      actualWeightMt: 11.9,
      outputThkMm: 1.48,
      destination: 'PACKING',
      defects: []
    });
    expect(res.status).toBe(200);

    // 6. End order
    res = await request(app).post(`/6hi/orders/${batchNo}/end?machine=2HI`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
  });
});
