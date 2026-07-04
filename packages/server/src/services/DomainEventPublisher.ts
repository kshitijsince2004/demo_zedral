import { randomUUID } from 'crypto';
import { buildEventEnvelope, getEventBus, type EventPayload } from '@zedral/platform';
import { getTenantId } from '../context';

export type LegacyDomainPayload = EventPayload & {
  eventId?: string;
  timestamp?: Date;
  processId?: string;
  shiftLogId?: string;
  coilNo?: string;
};

export class DomainEventPublisher {
  static enrichPayload(
    basePayload: EventPayload,
    processId: string,
    shiftLogId: string,
    coilNo: string,
  ): LegacyDomainPayload {
    return {
      ...basePayload,
      eventId: randomUUID(),
      timestamp: new Date(),
      processId,
      shiftLogId,
      coilNo,
    };
  }

  publish(eventName: string, payload: EventPayload): void {
    const tenantId = getTenantId() ?? '00000000-0000-0000-0000-000000000001';
    const eventId = typeof payload.eventId === 'string' ? payload.eventId : randomUUID();

    setImmediate(() => {
      void getEventBus().publish(
        buildEventEnvelope({
          type: eventName,
          tenantId,
          key: `${tenantId}:${eventName}:${eventId}`,
          payload: {
            ...payload,
            eventId,
          },
        }),
      ).catch((error) => {
        console.error(`[DomainEvent] failed to publish ${eventName}`, error);
      });
    });
  }
}

export const domainEvents = new DomainEventPublisher();
