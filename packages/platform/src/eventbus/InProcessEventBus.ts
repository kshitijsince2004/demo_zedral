import type { EventBus, EventEnvelope, EventHandler, EventPayload } from './EventBus';
import { assertCanonicalEventCompatible } from '../canonical/eventSchemas';

export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  async publish<TPayload extends EventPayload>(envelope: EventEnvelope<TPayload>): Promise<void> {
    assertCanonicalEventCompatible(envelope);
    const handlers = this.handlers.get(envelope.type);
    if (!handlers?.size) return;

    await Promise.all(
      Array.from(handlers).map((handler) => handler(envelope)),
    );
  }

  subscribe<TPayload extends EventPayload>(
    eventType: string,
    handler: EventHandler<TPayload>,
  ): () => void {
    const handlers = this.handlers.get(eventType) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.handlers.set(eventType, handlers);

    return () => {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.handlers.delete(eventType);
      }
    };
  }

  async shutdown(): Promise<void> {
    this.handlers.clear();
  }
}
