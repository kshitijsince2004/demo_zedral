import type { Connector } from '../framework/base';

export interface ConnectorPlugin {
  id: string;
  connector: Connector;
}

export const connectorPlugins: readonly ConnectorPlugin[] = [];
