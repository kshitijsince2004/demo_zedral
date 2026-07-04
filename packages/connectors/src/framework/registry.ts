import type { Connector } from './base';

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(connectorId: string, connector: Connector): void {
    if (this.connectors.has(connectorId)) {
      throw new Error(`Connector already registered: ${connectorId}`);
    }
    this.connectors.set(connectorId, connector);
  }

  get(connectorId: string): Connector | undefined {
    return this.connectors.get(connectorId);
  }

  list(): readonly string[] {
    return Array.from(this.connectors.keys());
  }
}
