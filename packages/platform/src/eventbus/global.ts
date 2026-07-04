import type { EventBus } from './EventBus';
import { InProcessEventBus } from './InProcessEventBus';
import { KafkaEventBus } from './KafkaEventBus';

let eventBus: EventBus | null = null;

export type EventBusKind = 'inprocess' | 'kafka';

function resolveEventBusKind(): EventBusKind {
  const raw = (process.env.EVENT_BUS_KIND ?? 'inprocess').toLowerCase();
  if (raw === 'kafka' || raw === 'inprocess') {
    return raw;
  }
  throw new Error(`Unsupported EVENT_BUS_KIND: ${raw}`);
}

export function initEventBus(kind: EventBusKind = resolveEventBusKind()): EventBus {
  if (eventBus) return eventBus;

  if (kind === 'kafka') {
    eventBus = new KafkaEventBus();
  } else if (kind === 'inprocess') {
    eventBus = new InProcessEventBus();
  } else {
    throw new Error(`Unsupported EVENT_BUS_KIND: ${kind}`);
  }

  return eventBus;
}

export function getEventBus(): EventBus {
  return eventBus ?? initEventBus();
}

export async function shutdownEventBus(): Promise<void> {
  if (!eventBus) return;
  await eventBus.shutdown();
  eventBus = null;
}
