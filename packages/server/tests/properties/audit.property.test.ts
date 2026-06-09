import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AuditTrailService } from '../../src/services/AuditTrailService';
import request from 'supertest';
import express from 'express';
import { UserRole } from '@m1/shared-validation';
import auditRoutes from '../../src/routes/auditRoutes';
import { db } from '../../src/db';

vi.mock('../../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { id: 1, role: UserRole.PLANT_HEAD, roles: [UserRole.PLANT_HEAD], processes: [] };
    next();
  },
  requireRole: (roles: any[]) => (req: any, res: any, next: any) => {
    next();
  },
}));

const app = express();
app.use(express.json());
app.use('/audit', auditRoutes);

describe('AuditTrailService & Routes (Tasks 12.3 - 12.5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Property 8 & Task 12.3: Audit immutability — INSERT/DELETE expose null change fields', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.constantFrom('INSERT' as const, 'DELETE' as const),
        fc.record({ key: fc.string() }),
        fc.integer(),
        (tableName, recordPk, action, values, userId) => {
          const entries = AuditTrailService.buildEntries(
            tableName,
            recordPk,
            action,
            action === 'DELETE' ? values : null,
            action === 'INSERT' ? values : null,
            userId,
          );

          expect(entries).toHaveLength(1);
          const entry = entries[0];
          expect(entry.action).toBe(action);
          expect(entry.column_name).toBeNull();
          
          if (action === 'INSERT') {
            expect(entry.old_value).toBeNull();
            expect(entry.new_value).toBe(JSON.stringify(values));
          } else {
            expect(entry.old_value).toBe(JSON.stringify(values));
            expect(entry.new_value).toBeNull();
          }
        }
      )
    );
  });

  it('Task 12.5: Method guard for non-GET from PLANT_HEAD -> 403', async () => {
    // Note: Our authMiddleware mock sets UserRole.PLANT_HEAD
    const postRes = await request(app).post('/audit').send({ test: 1 });
    expect(postRes.status).toBe(403);
    expect(postRes.body.error).toContain('read-only');

    const putRes = await request(app).put('/audit').send({ test: 1 });
    expect(putRes.status).toBe(403);
    
    const deleteRes = await request(app).delete('/audit');
    expect(deleteRes.status).toBe(403);
  });

  it('Property 14 & Task 12.4 & 12.5: Audit query maps correctly and covers all-scope', async () => {
    const mockDbDate = new Date('2026-06-01T12:00:00.000Z');
    
    const mockRow = {
      id: '100',
      table_name: 'test_table',
      record_pk: 'rec-1',
      action: 'UPDATE',
      column_name: 'status',
      old_value: 'pending',
      new_value: 'done',
      user_id: '42',
      created_at: mockDbDate,
    };

    const mockBuilder = {
      selectAll: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([mockRow]),
      executeTakeFirst: vi.fn().mockResolvedValue({ total: '1' }),
    };

    vi.spyOn(db, 'selectFrom').mockReturnValue(mockBuilder as any);

    const getRes = await request(app).get('/audit?scope=plant&pageSize=50');
    expect(getRes.status).toBe(200);
    
    const body = getRes.body;
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.records).toHaveLength(1);
    
    const rec = body.records[0];
    expect(rec.id).toBe(100);
    expect(rec.table_name).toBe('test_table');
    expect(rec.record_id).toBe('rec-1'); // mapped from record_pk
    expect(rec.action).toBe('UPDATE');
    expect(rec.field).toBe('status'); // mapped from column_name
    expect(rec.old_value).toBe('pending');
    expect(rec.new_value).toBe('done');
    expect(rec.user_id).toBe(42);
    expect(rec.timestamp).toBe(mockDbDate.toISOString());
  });
});
