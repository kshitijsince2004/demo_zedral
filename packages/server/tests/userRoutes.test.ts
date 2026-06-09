import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 1, roles: ['ADMIN'], lineAccess: [] };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateLineAccess = vi.fn();

vi.mock('../src/services/UserService', () => ({
  UserService: {
    list: (...args: unknown[]) => mockList(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    updateLineAccess: (...args: unknown[]) => mockUpdateLineAccess(...args),
    getById: vi.fn(),
  },
}));

import userRoutes from '../src/routes/userRoutes';

const app = express();
app.use(express.json());
app.use('/users', userRoutes);

describe('userRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /users returns user list', async () => {
    mockList.mockResolvedValue([
      {
        id: '1',
        username: 'op1',
        display_name: 'Operator One',
        emp_code: '3344',
        role: 'OPERATOR',
        status: 'ACTIVE',
        line_access: [{ line_id: 'HRS', level: 'WRITE' }],
      },
    ]);

    const res = await request(app).get('/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].emp_code).toBe('3344');
  });

  it('POST /users creates a user', async () => {
    mockCreate.mockResolvedValue({ id: '2', username: 'newop' });

    const res = await request(app).post('/users').send({
      username: 'newop',
      display_name: 'New Operator',
      role: 'OPERATOR',
      status: 'ACTIVE',
      emp_code: '7788',
      pin: '4321',
      line_access: [{ line_id: 'HRS', level: 'WRITE' }],
    });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'newop',
        emp_code: '7788',
        pin: '4321',
      })
    );
  });

  it('PUT /users/:id updates a user', async () => {
    mockUpdate.mockResolvedValue({ id: '1', status: 'DISABLED' });

    const res = await request(app).put('/users/1').send({
      username: 'op1',
      display_name: 'Operator One',
      role: 'SUPERVISOR',
      status: 'DISABLED',
      line_access: [],
    });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('1', expect.objectContaining({ role: 'SUPERVISOR' }));
  });

  it('PUT /users/:id/line-access updates line scope', async () => {
    mockUpdateLineAccess.mockResolvedValue({
      id: '1',
      line_access: [{ line_id: 'CRM', level: 'APPROVE' }],
    });

    const res = await request(app)
      .put('/users/1/line-access')
      .send({ line_access: [{ line_id: 'CRM', level: 'APPROVE' }] });

    expect(res.status).toBe(200);
    expect(mockUpdateLineAccess).toHaveBeenCalledWith('1', [
      { line_id: 'CRM', level: 'APPROVE' },
    ]);
  });
});
