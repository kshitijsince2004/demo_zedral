import { ConnectorRegistry } from './framework/registry';
import { connectorPlugins } from './plugins';

const registry = new ConnectorRegistry();

for (const plugin of connectorPlugins) {
  registry.register(plugin.id, plugin.connector);
}

console.log(`[connectors] registered ${registry.list().length} connector plugin(s)`);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[connectors] ${signal} received; connector runtime stopped`);
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('unhandledRejection', (reason) => {
  console.error('[connectors] unhandled rejection', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[connectors] uncaught exception', error);
  void shutdown('uncaughtException');
});

// Keep the connector deployment alive even when no client plugin is installed yet.
setInterval(() => undefined, 60_000);
