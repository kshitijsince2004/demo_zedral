import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEventEnvelope,
  initEventBus,
  shutdownEventBus,
} from '@zedral/platform';
import { canonicalEventSchemas } from '../../../platform/src/canonical/eventSchemas';

const repoRoot = path.resolve(__dirname, '../../../..');

describe('D12 event bus governance', () => {
  afterEach(async () => {
    await shutdownEventBus();
  });

  it('selects an implemented provider and rejects unsupported providers', async () => {
    const bus = initEventBus('inprocess');
    const seen: string[] = [];
    const unsubscribe = bus.subscribe('production.captured', (event) => {
      seen.push(String(event.payload.entryId));
    });

    await bus.publish(buildEventEnvelope({
      type: 'production.captured',
      tenantId: 'tenant-1',
      key: 'tenant-1:production.captured:entry-1',
      payload: {
        processCode: 'HRS',
        shiftLogId: 'shift-1',
        entryId: 'entry-1',
        coilNo: 'coil-1',
      },
    }));

    unsubscribe();
    expect(seen).toEqual(['entry-1']);
    await shutdownEventBus();
    expect(() => initEventBus('redis' as never)).toThrow(/Unsupported|redis/i);
  });

  it('enforces canonical event compatibility before publish', async () => {
    const bus = initEventBus('inprocess');
    await expect(
      bus.publish(buildEventEnvelope({
        type: 'production.counted',
        tenantId: 'tenant-1',
        key: 'tenant-1:production.counted:bad',
        payload: {
          countId: 'count-1',
          quantity: 1,
          uom: 'MT',
          countedAt: new Date().toISOString(),
          lineageRef: 'test',
        },
      })),
    ).rejects.toThrow(/assetId/);
  });

  it('keeps every registered M1 event versioned and backed by adapter code', () => {
    expect(canonicalEventSchemas['production.captured']).toMatchObject({
      event: 'production.captured',
      version: 1,
    });

    const kafkaSource = fs.readFileSync(
      path.join(repoRoot, 'packages/platform/src/eventbus/KafkaEventBus.ts'),
      'utf8',
    );
    expect(kafkaSource).toContain('kafkajs');
    expect(kafkaSource).toContain('disconnect');
    expect(kafkaSource).not.toContain('not installed');
    expect(fs.existsSync(path.join(repoRoot, 'packages/platform/src/eventbus/RedisEventBus.ts'))).toBe(false);
  });
});
