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

console.log('Operator bundle purity check passed.');
