import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'dist-operator');

const excluded = ['"/plant"', 'maint/', 'oee/', 'm3/'];
const required = [
  '/6hi/manual-stoppage',
  'Manage Manual Stoppage',
  'Start Stoppage',
  'DeviceStatus',
];

function walk(dir, visit) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, visit);
    else if (/\.(js|css|html)$/.test(name.name)) visit(p);
  }
}

if (!fs.existsSync(root)) {
  console.error('Operator bundle missing. Run npm run build:operator first.');
  process.exit(1);
}

const excludedHits = [];
const bundleText = [];

walk(root, (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8');
  bundleText.push(text);
  for (const token of excluded) {
    if (text.includes(token)) excludedHits.push(`${filePath} -> ${token}`);
  }
});

if (excludedHits.length) {
  console.error('Operator bundle purity check failed:\n' + excludedHits.join('\n'));
  process.exit(1);
}

const combined = bundleText.join('\n');
const missing = required.filter((token) => !combined.includes(token));
if (missing.length) {
  console.error('Operator bundle missing required CRM features:\n' + missing.join('\n'));
  process.exit(1);
}

// PERF 1.6: SixHi + Process mill shells must be separate lazy chunks (not one mega entry).
const assetsDir = path.join(root, 'assets');
const assetNames = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((n) => n.endsWith('.js'))
  : [];
const sixHiChunk = assetNames.find((n) => /^SixHiLayout-.*\.js$/.test(n));
const processChunk = assetNames.find((n) => /^ProcessLayout-.*\.js$/.test(n));
if (!sixHiChunk || !processChunk) {
  console.error(
    'Operator bundle missing lazy mill shells (expected SixHiLayout-*.js and ProcessLayout-*.js in assets/).\n' +
      `Found sixHi=${sixHiChunk ?? 'none'} process=${processChunk ?? 'none'}`,
  );
  process.exit(1);
}
if (sixHiChunk === processChunk) {
  console.error('Operator mill shells incorrectly share one chunk file.');
  process.exit(1);
}

console.log(
  `Operator bundle purity check passed (mill chunks: ${sixHiChunk}, ${processChunk}).`,
);
