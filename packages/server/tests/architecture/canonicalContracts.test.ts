import { describe, expect, it } from 'vitest';
import { m1ManifestMeta } from '@zedral/m1-collection';
import { canonicalEventSchemas } from '../../../platform/src/canonical/eventSchemas';

describe('D12 canonical contract governance', () => {
  it('registers a versioned schema for every M1-produced canonical event', () => {
    for (const eventName of m1ManifestMeta.producesEvents) {
      const schema = canonicalEventSchemas[eventName];
      expect(schema, `${eventName} must have a canonical event schema`).toBeDefined();
      expect(schema.event).toBe(eventName);
      expect(schema.version).toBe(1);
      expect(schema.requiredPayloadFields.length).toBeGreaterThan(0);
    }
  });

  it('keeps canonical event schema names aligned with registry keys', () => {
    for (const [eventName, schema] of Object.entries(canonicalEventSchemas)) {
      expect(schema.event).toBe(eventName);
      expect(schema.version).toBeGreaterThan(0);
    }
  });
});
