import type { EventEnvelope, EventPayload } from '@zedral/platform';

export interface SourceProfile {
  sourceId: string;
  sourceType: string;
  tenantId: string;
  capabilities: readonly string[];
}

export interface Cursor {
  value: string;
  observedAt: string;
}

export interface RawRecord {
  sourceId: string;
  recordId: string;
  observedAt: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface ConnectorContext {
  tenantId: string;
  connectorId: string;
}

export interface Connector<TPayload extends EventPayload = EventPayload> {
  discover(context: ConnectorContext): Promise<SourceProfile>;
  read(context: ConnectorContext, since?: Cursor): AsyncIterable<RawRecord>;
  toCanonical(context: ConnectorContext, raw: RawRecord): Promise<readonly EventEnvelope<TPayload>[]>;
}
