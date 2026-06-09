/**
 * Process Section Registry
 *
 * Maps canonical process codes to their section descriptors.
 * Only the eight canonical codes defined in master.process are registered:
 *   HRS, PKL, CRM, ANN, SKP, RWD, CRS, CTL
 *
 * Non-canonical codes (SPM, REW, and any other string) resolve to null,
 * which causes the unified capture route to render a not-found state.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5
 */

import type { ComponentType, LazyExoticComponent } from 'react';
import { lazy } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

/** The nine canonical process codes from master.process / M1_schema.sql. */
export type ProcessCode = 'HRS' | 'PKL' | 'CRM' | '6HI' | 'ANN' | 'SKP' | 'RWD' | 'CRS' | 'CTL' | 'GLV';

/** Props passed to every process section component. */
export interface ProcessSectionProps {
  /** The resolved canonical process code. */
  processCode: ProcessCode;
  /** Optional coil number for auto-source prefill. */
  coilNo?: string;
}

/** Descriptor returned by the registry for a valid process code. */
export interface ProcessSectionDescriptor {
  code: ProcessCode;
  /** Human-readable process name shown in the shell header. */
  title: string;
  /** The section component rendered inside ShiftLogShell. */
  Section: ComponentType<ProcessSectionProps> | LazyExoticComponent<ComponentType<ProcessSectionProps>>;
  /** REST endpoint for this process: `/entries/${code.toLowerCase()}` */
  endpoint: string;
}

// ─── Canonical code set ───────────────────────────────────────────────────────

/**
 * Ordered list of canonical process codes.
 * Matches the sidebar's CANONICAL_PROCESS_CODES and the DDL master.process table.
 */
export const CANONICAL_PROCESS_CODES: readonly ProcessCode[] = [
  'HRS', 'PKL', '6HI', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL', 'GLV'
] as const;

// ─── Registry map ─────────────────────────────────────────────────────────────
//
// Section components are loaded via React.lazy() to:
//   1. Break the module-graph cycle that caused IndexedDB errors in the test
//      environment (the real section components → syncEngine → offlineStore →
//      openDB which requires a browser).
//   2. Enable code splitting for faster initial page load.
//
// The property test for route resolution (Property 1) imports only
// `resolveProcessSection`, `isValidProcessCode`, and `CANONICAL_PROCESS_CODES`
// — none of those symbols touch the lazy factories — so the test runs cleanly
// in Node/Vitest without a browser environment.

const REGISTRY_MAP: Record<ProcessCode, ProcessSectionDescriptor> = {
  HRS: {
    code: 'HRS',
    title: 'Hot Rolling',
    Section: lazy(() => import('../components/sections/HRSSection').then(m => ({ default: m.HRSSection }))),
    endpoint: '/entries/hrs',
  },
  PKL: {
    code: 'PKL',
    title: 'Pickling',
    Section: lazy(() => import('../components/sections/PKLSection').then(m => ({ default: m.PKLSection }))),
    endpoint: '/entries/pkl',
  },
  CRM: {
    code: 'CRM',
    title: 'Cold Rolling (Legacy)',
    Section: lazy(() => import('../components/sections/CRMSection').then(m => ({ default: m.CRMSection }))),
    endpoint: '/entries/crm',
  },
  '6HI': {
    code: '6HI',
    title: '6HI',
    Section: lazy(() => import('../pages/sixHi/SixHiRedirect').then(m => ({ default: m.SixHiRedirect }))),
    endpoint: '/6hi',
  },
  ANN: {
    code: 'ANN',
    title: 'Annealing',
    Section: lazy(() => import('../components/sections/ANNSection').then(m => ({ default: m.ANNSection }))),
    endpoint: '/entries/ann',
  },
  SKP: {
    code: 'SKP',
    title: 'Skin Pass',
    Section: lazy(() => import('../components/sections/SKPSection').then(m => ({ default: m.SKPSection }))),
    endpoint: '/entries/skp',
  },
  RWD: {
    code: 'RWD',
    title: 'Rewind',
    Section: lazy(() => import('../components/sections/RWDSection').then(m => ({ default: m.RWDSection }))),
    endpoint: '/entries/rwd',
  },
  CRS: {
    code: 'CRS',
    title: 'CR Slitter',
    Section: lazy(() => import('../components/sections/CRSSection').then(m => ({ default: m.CRSSection }))),
    endpoint: '/entries/crs',
  },
  CTL: {
    code: 'CTL',
    title: 'Cut-to-Length',
    Section: lazy(() => import('../components/sections/CTLSection').then(m => ({ default: m.CTLSection }))),
    endpoint: '/entries/ctl',
  },
  GLV: {
    code: 'GLV',
    title: 'Galvanizing',
    Section: lazy(() => import('../components/sections/GLVSection').then(m => ({ default: m.GLVSection }))),
    endpoint: '/entries/glv',
  },
};

// ─── Registry API ─────────────────────────────────────────────────────────────

/**
 * Returns true if `processId` is one of the eight canonical process codes.
 * The comparison is case-sensitive — the sidebar and routes use uppercase codes.
 */
export function isValidProcessCode(processId: string): processId is ProcessCode {
  return (CANONICAL_PROCESS_CODES as readonly string[]).includes(processId);
}

/**
 * Resolves a route `:processId` parameter to its section descriptor.
 *
 * Returns `null` for any string that is not a canonical process code,
 * including removed codes (SPM, REW) and arbitrary strings.
 *
 * Requirements: 1.4
 */
export function resolveProcessSection(
  processId: string,
): ProcessSectionDescriptor | null {
  if (!isValidProcessCode(processId)) return null;
  return REGISTRY_MAP[processId];
}
