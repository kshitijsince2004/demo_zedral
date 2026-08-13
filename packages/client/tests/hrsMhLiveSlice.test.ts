import { describe, expect, it } from 'vitest';
import {
  filterHrsSearch,
  hrsLineStatus,
  hrsLiveKpis,
  sliceHrsQueue,
} from '../src/lib/hrsMhLiveSlice';

const q = (status: string, coilNo = 'C1') => ({
  coilNo,
  status,
  gradeCode: 'G',
  customerName: 'Cust',
});

describe('hrsMhLiveSlice', () => {
  const queue = [
    q('PENDING', 'P'),
    q('PREPARING', 'R'),
    q('IN_PROGRESS', 'I'),
    q('STOPPAGE', 'S'),
    q('REJECTED', 'H'),
    q('COMPLETED', 'D'),
  ];

  it('slices orders / hold / history', () => {
    expect(sliceHrsQueue(queue, 'orders').map((c) => c.coilNo)).toEqual(['P', 'R']);
    expect(sliceHrsQueue(queue, 'rejected').map((c) => c.coilNo)).toEqual(['H']);
    expect(sliceHrsQueue(queue, 'completed').map((c) => c.coilNo)).toEqual(['D']);
  });

  it('filters search across coil and customer', () => {
    expect(filterHrsSearch(queue, 'cust').map((c) => c.coilNo)).toHaveLength(6);
    expect(filterHrsSearch(queue, 'I').map((c) => c.coilNo)).toEqual(['I']);
  });

  it('derives line status and KPIs', () => {
    expect(hrsLineStatus(queue, false)).toBe('RUNNING');
    expect(hrsLineStatus(queue.filter((c) => c.status !== 'IN_PROGRESS'), false)).toBe('STOPPAGE');
    expect(hrsLineStatus([q('PENDING')], false)).toBe('IDLE');
    const k = hrsLiveKpis(queue, true);
    expect(k.running).toBe(1);
    expect(k.activeOrders).toBe(2);
    expect(k.stoppages).toBe(2);
  });
});
