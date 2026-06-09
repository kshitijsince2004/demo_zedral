import fs from 'fs';
import path from 'path';
import type { LineLogLayout } from './types';

const PROCESS_CODES = ['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'] as const;
export type LineLogProcessCode = (typeof PROCESS_CODES)[number];

const cache = new Map<string, LineLogLayout>();

function resolveLayoutPath(code: string): string {
  const candidates = [
    path.join(__dirname, `${code}.json`),
    path.join(process.cwd(), 'src', 'export', 'layouts', 'line_log', `${code}.json`),
    path.join(process.cwd(), 'dist', 'export', 'layouts', 'line_log', `${code}.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Line log layout not found for ${code}`);
}

export function loadLineLogLayout(processCode: string): LineLogLayout {
  const code = normalizeProcessCode(processCode);
  if (!cache.has(code)) {
    cache.set(code, JSON.parse(fs.readFileSync(resolveLayoutPath(code), 'utf8')) as LineLogLayout);
  }
  return cache.get(code)!;
}

export function listLineLogProcesses(): LineLogProcessCode[] {
  return [...PROCESS_CODES];
}

/** CRM layout maps to 6HI capture process in DB. */
export function dbProcessCode(processCode: string): string {
  const code = normalizeProcessCode(processCode);
  return code === 'CRM' ? '6HI' : code;
}

export function normalizeProcessCode(processCode: string): LineLogProcessCode {
  const code = processCode.toUpperCase();
  if (code === '6HI') return 'CRM';
  if (!PROCESS_CODES.includes(code as LineLogProcessCode)) {
    throw new Error(`Unsupported line log process: ${processCode}`);
  }
  return code as LineLogProcessCode;
}

export function mandatoryBodyFields(layout: LineLogLayout): string[] {
  return layout.body.columns.filter((c) => c.mandatory).map((c) => c.field);
}
