/**
 * Fail fast when another process already owns the API/Vite ports.
 * Checks both IPv4 and IPv6 — Windows can dual-bind so a second checkout on ::1
 * still serves `localhost` while 0.0.0.0 appears free.
 */
import net from 'node:net';

const checks = [
  { port: Number(process.env.PORT || 3005), label: 'API (backend)' },
  { port: Number(process.env.VITE_PORT || 3000), label: 'Vite (frontend)' },
];

function canBind(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

const blocked = [];
for (const { port, label } of checks) {
  const ipv4Ok = await canBind(port, '0.0.0.0');
  const ipv6Ok = await canBind(port, '::');
  if (!ipv4Ok || !ipv6Ok) {
    const which = [!ipv4Ok && 'IPv4', !ipv6Ok && 'IPv6'].filter(Boolean).join('+');
    blocked.push(`${label} :${port} (${which})`);
  }
}

if (blocked.length > 0) {
  console.error(
    `[dev:all] Port(s) already in use: ${blocked.join(', ')}.\n` +
      'Stop the other Node/Vite process (often another Zedral checkout) and retry.',
  );
  process.exit(1);
}
