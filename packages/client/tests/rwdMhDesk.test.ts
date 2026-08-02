import { describe, it, expect } from 'vitest';
import { isRwdMhDesk, rwdAssigned, resolveRwdLiveLine } from '../src/lib/rwdMhDesk';

describe('isRwdMhDesk', () => {
  it('true when focus is RWD and assigned', () => {
    expect(isRwdMhDesk(['6HI', 'RWD'], 'RWD')).toBe(true);
  });

  it('true when sole machine is RWD', () => {
    expect(isRwdMhDesk(['RWD'], null)).toBe(true);
  });

  it('false for multi-machine without RWD focus', () => {
    expect(isRwdMhDesk(['6HI', 'RWD'], null)).toBe(false);
    expect(isRwdMhDesk(['6HI'], '6HI')).toBe(false);
  });

  it('2HI focus with RWD assigned stays on rewinding desk', () => {
    expect(isRwdMhDesk(['RWD', '2HI'], '2HI')).toBe(true);
  });

  it('2HI focus alone is not RWD desk (CRM mill stays CRM)', () => {
    expect(isRwdMhDesk(['6HI', '2HI'], '2HI')).toBe(false);
  });
});

describe('rwdAssigned / resolveRwdLiveLine', () => {
  it('lists RWD and 2HI', () => {
    expect(rwdAssigned(['6HI', 'RWD', '2HI'])).toEqual(['RWD', '2HI']);
  });

  it('resolves focus preferentially', () => {
    expect(resolveRwdLiveLine(['RWD', '2HI'], '2HI')).toBe('2HI');
    expect(resolveRwdLiveLine(['RWD', '2HI'], null)).toBe('RWD');
  });
});
