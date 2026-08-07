/**
 * List bare imports from src/ that are not declared in this package's dependencies.
 * Run: node scripts/audit-runtime-deps.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|js)$/.test(e.name) && !e.name.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'fs/promises',
  'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'path/posix',
  'path/win32', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util',
  'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const importRe =
  /^\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|.*\brequire\()\s*['"]([^'"]+)['"]/gm;

const missing = new Map();
const src = path.join(root, 'src');
for (const f of walk(src)) {
  const t = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = importRe.exec(t))) {
    const raw = m[1];
    if (raw.startsWith('.') || raw.startsWith('node:')) continue;
    const name = raw.startsWith('@')
      ? raw.split('/').slice(0, 2).join('/')
      : raw.split('/')[0];
    if (NODE_BUILTINS.has(name)) continue;
    if (!deps.has(name)) {
      if (!missing.has(name)) missing.set(name, []);
      missing.get(name).push(path.relative(src, f));
    }
  }
}

if (missing.size === 0) {
  console.log('OK: all bare imports declared in dependencies/optionalDependencies');
  process.exit(0);
}
console.log('MISSING from package.json dependencies:');
for (const [name, files] of [...missing.entries()].sort()) {
  console.log(`  ${name}`);
  for (const f of [...new Set(files)].slice(0, 8)) console.log(`    - ${f}`);
}
process.exit(1);
