import type { ComponentType } from 'react';
import type { z } from 'zod';
import {
  hrsSchema,
  pklSchema,
  annSchema,
  rwdSchema,
  crsSchema,
  ctlSchema,
} from '@m1/shared-validation';
import { HrsSlitBuilder } from '../components/process/bodies/HrsSlitBuilder';
import { RwdTensionForm } from '../components/process/bodies/RwdTensionForm';
import { CrsQualityForm } from '../components/process/bodies/CrsQualityForm';
import { CtlPieceCounter } from '../components/process/bodies/CtlPieceCounter';
import { PklCoilForm } from '../components/process/bodies/PklCoilForm';
import { AnnChargeBoard } from '../components/process/bodies/AnnChargeBoard';

export type ProcessStationCode = 'HRS' | 'PKL' | 'ANN' | 'RWD' | 'CRS' | 'CTL';
export type Archetype = 'A' | 'B' | 'C';

export interface BodyProps {
  coilNo: string;
  prefill: Record<string, unknown>;
  shiftLogId: string;
  machineCode: string;
  onSubmitted?: () => void;
}

export interface ProcessConfig {
  code: ProcessStationCode;
  label: string;
  archetype: Archetype;
  endpoint: string;
  schema: z.ZodTypeAny;
  bodyComponent: ComponentType<BodyProps>;
  routeCode: string;
  extraTabs?: { id: string; label: string; path: string }[];
}

const PROCESS_STATIONS: ProcessStationCode[] = ['HRS', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL'];

export function isProcessStationCode(code: string): code is ProcessStationCode {
  return PROCESS_STATIONS.includes(code as ProcessStationCode);
}

export const PROCESS_CONFIG: Record<ProcessStationCode, ProcessConfig> = {
  HRS: {
    code: 'HRS',
    label: 'HR Slitting',
    archetype: 'A',
    endpoint: '/production/hrs',
    schema: hrsSchema,
    bodyComponent: HrsSlitBuilder,
    routeCode: 'S',
  },
  PKL: {
    code: 'PKL',
    label: 'Pickling',
    archetype: 'C',
    endpoint: '/production/pkl',
    schema: pklSchema,
    bodyComponent: PklCoilForm,
    routeCode: 'P',
    extraTabs: [{ id: 'chart', label: 'Process Chart', path: 'chart' }],
  },
  ANN: {
    code: 'ANN',
    label: 'Annealing',
    archetype: 'B',
    endpoint: '/production/ann',
    schema: annSchema,
    bodyComponent: AnnChargeBoard,
    routeCode: 'F',
  },
  RWD: {
    code: 'RWD',
    label: 'Rewinding',
    archetype: 'A',
    endpoint: '/production/rwd',
    schema: rwdSchema,
    bodyComponent: RwdTensionForm,
    routeCode: 'R',
  },
  CRS: {
    code: 'CRS',
    label: 'CR Slitting',
    archetype: 'A',
    endpoint: '/production/crs',
    schema: crsSchema,
    bodyComponent: CrsQualityForm,
    routeCode: 'C',
  },
  CTL: {
    code: 'CTL',
    label: 'Cut-to-Length',
    archetype: 'A',
    endpoint: '/production/ctl',
    schema: ctlSchema,
    bodyComponent: CtlPieceCounter,
    routeCode: 'LE',
  },
};

export function getProcessConfig(code: string): ProcessConfig {
  if (isProcessStationCode(code)) return PROCESS_CONFIG[code];
  return PROCESS_CONFIG.HRS;
}
