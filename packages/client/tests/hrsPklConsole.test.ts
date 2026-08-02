import { describe, it, expect } from 'vitest';
import { deltaBand } from '../src/components/process/ProcessPairedField';
import {
  hrsPklAssigned,
  isHrsMhDesk,
  isHrsPklMhDesk,
  isPklMhDesk,
} from '../src/lib/pklMhDesk';

describe('deltaBand', () => {
  it('marks in-band green and out-of-band warn', () => {
    expect(deltaBand(100.2, 100, 0.5).band).toBe('ok');
    expect(deltaBand(101, 100, 0.5).band).toBe('warn');
    expect(deltaBand(undefined, 100, 0.5).band).toBe('na');
  });
});

describe('hrsPklMhDesk', () => {
  it('detects sole HRS / PKL and combined pair', () => {
    expect(isHrsMhDesk(['HRS'], null)).toBe(true);
    expect(isPklMhDesk(['PKL'], null)).toBe(true);
    expect(isHrsPklMhDesk(['HRS', 'PKL'], null)).toBe(true);
    expect(isHrsPklMhDesk(['HRS', 'PKL'], 'HRS')).toBe(true);
    expect(isHrsPklMhDesk(['6HI', 'HRS', 'PKL'], null)).toBe(false);
    expect(isHrsPklMhDesk(['6HI', 'HRS', 'PKL'], 'PKL')).toBe(true);
    expect(hrsPklAssigned(['hrs', 'pkl', '6hi'])).toEqual(['HRS', 'PKL']);
  });
});
