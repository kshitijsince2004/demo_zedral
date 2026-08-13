import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.fn();

vi.mock('../src/db', () => ({
  db: {
    selectFrom: () => ({
      select: () => ({
        where: () => ({ execute }),
      }),
    }),
  },
}));

describe('resolveRollingProcessId', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('prefers ROLLING over historical aliases', async () => {
    execute.mockResolvedValue([
      { process_id: 99, code: 'CRM6' },
      { process_id: 31, code: 'ROLLING' },
      { process_id: 31, code: '6HI' },
    ]);
    const { resolveRollingProcessId } = await import('../src/utils/rollingProcess');
    expect(await resolveRollingProcessId()).toBe(31);
  });

  it('accepts 6HI when ROLLING/CRM are absent', async () => {
    execute.mockResolvedValue([{ process_id: 31, code: '6HI' }]);
    const { resolveRollingProcessId } = await import('../src/utils/rollingProcess');
    expect(await resolveRollingProcessId()).toBe(31);
  });

  it('throws when no rolling alias exists', async () => {
    execute.mockResolvedValue([]);
    const { resolveRollingProcessId } = await import('../src/utils/rollingProcess');
    await expect(resolveRollingProcessId()).rejects.toThrow(/6HI process not configured/);
  });
});
