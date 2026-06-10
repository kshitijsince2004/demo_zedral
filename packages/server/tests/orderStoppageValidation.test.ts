import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    fn: {
      count: vi.fn(() => ({ as: vi.fn(() => 'c') })),
    },
  },
}));

import { assertCanStartOrderStoppage } from '../src/validation/orderStoppageValidation';
import { ManufacturingValidationError } from '../src/validation/manufacturingValidation';
import { db } from '../src/db';

describe('orderStoppageValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks duplicate active stoppages', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ c: 1 }),
    };
    vi.mocked(db.selectFrom).mockReturnValue(chain as never);

    await expect(assertCanStartOrderStoppage('42')).rejects.toThrow(ManufacturingValidationError);
  });
});
