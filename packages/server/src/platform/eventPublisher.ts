import { buildEventEnvelope, getEventBus, type EventPayload } from '@zedral/platform';
import { getTenantId } from '../context';

export interface PublishDomainEventInput<TPayload extends EventPayload> {
  type: string;
  key: string;
  payload: TPayload;
  lineageRef?: string;
  occurredAt?: Date;
}

export async function publishDomainEvent<TPayload extends EventPayload>(
  input: PublishDomainEventInput<TPayload>,
): Promise<void> {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error('Tenant context is required to publish domain events');
  }

  await getEventBus().publish(
    buildEventEnvelope({
      type: input.type,
      key: input.key,
      tenantId,
      lineageRef: input.lineageRef,
      occurredAt: input.occurredAt,
      payload: input.payload,
    }),
  );
}
