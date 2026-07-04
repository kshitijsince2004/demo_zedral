export type EventPayload = Readonly<Record<string, unknown>>;

export interface EventEnvelope<TPayload extends EventPayload = EventPayload> {
  id: string;
  type: string;
  version: number;
  tenantId: string;
  occurredAt: string;
  key: string;
  lineageRef?: string;
  payload: TPayload;
}

export type EventHandler<TPayload extends EventPayload = EventPayload> = (
  envelope: EventEnvelope<TPayload>,
) => void | Promise<void>;

export interface EventBus {
  publish<TPayload extends EventPayload>(envelope: EventEnvelope<TPayload>): Promise<void>;
  subscribe<TPayload extends EventPayload>(eventType: string, handler: EventHandler<TPayload>): () => void;
  shutdown(): Promise<void>;
}
