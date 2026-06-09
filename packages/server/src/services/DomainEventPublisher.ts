import { EventEmitter } from 'events';

export class DomainEventPublisher extends EventEmitter {
  constructor() {
    super();
    
    // Register basic logging listeners for our domain events
    this.on('SHIFT_SUBMITTED', (payload) => {
      console.log(`[DomainEvent] SHIFT_SUBMITTED: Shift ${payload.shiftId} completed by ${payload.operator}.`);
      // In production, this pushes to Kafka or triggers downstream ERP workflows.
    });

    this.on('DEFECT_LOGGED', (payload) => {
      console.log(`[DomainEvent] DEFECT_LOGGED: Defect mapped to Coil ${payload.coilNo}.`);
      // In production, might trigger an immediate QA notification via SMS/Email.
    });
  }

  static enrichPayload(basePayload: any, processId: string, shiftLogId: string, coilNo: string) {
    return {
      ...basePayload,
      eventId: require('crypto').randomUUID(),
      timestamp: new Date(),
      processId,
      shiftLogId,
      coilNo,
    };
  }

  publish(eventName: string, payload: any) {
    // Fire asynchronously so it doesn't block the caller
    setImmediate(() => {
      this.emit(eventName, payload);
    });
  }
}

export const domainEvents = new DomainEventPublisher();
