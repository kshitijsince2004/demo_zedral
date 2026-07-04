import { randomUUID } from 'crypto';
import type { EventEnvelope, EventPayload } from './EventBus';

export interface BuildEventEnvelopeInput<TPayload extends EventPayload> {
  type: string;
  version?: number;
  tenantId: string;
  key: string;
  lineageRef?: string;
  payload: TPayload;
  occurredAt?: Date;
}

export function buildEventEnvelope<TPayload extends EventPayload>(
  input: BuildEventEnvelopeInput<TPayload>,
): EventEnvelope<TPayload> {
  return {
    id: randomUUID(),
    type: input.type,
    version: input.version ?? 1,
    tenantId: input.tenantId,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    key: input.key,
    lineageRef: input.lineageRef,
    payload: input.payload,
  };
}
