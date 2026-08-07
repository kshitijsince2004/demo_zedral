// PERF-B3 — panel chrome + shared helpers extracted from MachineHeadDashboard
import type { ReactNode } from 'react';
import type { LiveOrderRow, MachineHeadDashboardData, RejectedOrderRow } from '@m1/shared-validation';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { formatPlantDate } from '../../lib/dateFormat';
import {
  type ManualRerollSession,
} from '../../services/manualRerollService';

export type DashboardTab = 'overview' | 'orders' | 'production' | 'stoppages' | 'rejected' | 'completed' | 'handover';
export type ProcessFilter = 'ALL' | 'ROLLING' | 'SKIN_PASS';
/** History tab pills — Rolling / Skin Pass / Manual Re-Rolling (+ All). */
export type HistoryProcessFilter = 'ALL' | 'ROLLING' | 'SKIN_PASS' | 'MANUAL_REROLL';

export const CRM_HISTORY_MILLS = ['6HI', '4HI', '2HI'] as const;

export const ORDER_TABS: DashboardTab[] = ['orders', 'production', 'stoppages', 'rejected', 'completed'];
export const PROCESS_FILTER_TABS: DashboardTab[] = [...ORDER_TABS, 'handover'];

/** Active shopfloor statuses that belong on the Orders tab (includes stoppage). */
export const ACTIVE_ORDER_STATUSES = new Set(['PREPARING', 'IN_PROGRESS', 'RUNNING', 'STOPPAGE']);

export type HistoryRow = {
  kind: 'CRM' | 'MANUAL_REROLL';
  key: string;
  batchNumber: string;
  machineCode: string;
  customer?: string;
  grade?: string;
  weightMt?: number;
  prodEndAt?: string;
  subProcess: string;
  coilNo?: string;
  motherCoil?: string;
  slitId?: string;
  operatorName?: string;
};

export const DASHBOARD_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'stoppages', label: 'Stoppages' },
  { id: 'completed', label: 'History' },
  { id: 'production', label: 'Production' },
  { id: 'rejected', label: 'Order Hold' },
  { id: 'handover', label: 'Handover' },
] as const;

/** PERF-B2 — virtualize when list grows past this. */
export const VIRTUALIZE_THRESHOLD = 20;

export function matchesProcessFilter(subProcess: string | undefined, filter: ProcessFilter, allowUnknown = false): boolean {
  if (filter === 'ALL') return true;
  if (!subProcess) return allowUnknown;
  return subProcess === filter;
}

export function sessionPlantDate(s: ManualRerollSession): string {
  return formatPlantDate(s.endTime ?? s.startTime);
}

export function mapRerollSessionToHistory(s: ManualRerollSession): HistoryRow {
  const batches = (s.batchNumbers?.length ? s.batchNumbers : s.batchNumber ? [s.batchNumber] : [])
    .filter(Boolean) as string[];
  const batchLabel = batches.length > 1 ? batches.join(' · ') : (batches[0] ?? s.sessionId);
  return {
    kind: 'MANUAL_REROLL',
    key: `mr-${s.sessionId}`,
    batchNumber: batchLabel,
    machineCode: s.machineCode,
    weightMt: s.rerollQuantity != null ? Number(s.rerollQuantity) : undefined,
    prodEndAt: s.endTime ?? undefined,
    subProcess: 'MANUAL_REROLL',
  };
}

export function mapCrmCompletedToHistory(o: {
  batchNumber: string;
  machineCode?: string;
  customer?: string;
  grade?: string;
  weightMt?: number;
  prodEndAt?: string;
  subProcess?: string;
  coilNo?: string;
  motherCoil?: string;
  slitId?: string;
  operatorName?: string;
}): HistoryRow {
  return {
    kind: 'CRM',
    key: `crm-${o.batchNumber}`,
    batchNumber: o.batchNumber,
    machineCode: o.machineCode ?? '—',
    customer: o.customer,
    grade: o.grade,
    weightMt: o.weightMt != null ? Number(o.weightMt) : undefined,
    prodEndAt: o.prodEndAt,
    subProcess: o.subProcess === 'SKIN_PASS' ? 'SKIN_PASS' : 'ROLLING',
    coilNo: o.coilNo,
    motherCoil: o.motherCoil,
    slitId: o.slitId,
    operatorName: o.operatorName,
  };
}

export function formatDuration(minutes?: number): string {
  if (minutes == null || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Live HH:MM:SS for active stoppages; static minutes for ended ones. */
export function StoppageDurationCell({
  startAt,
  active,
  durationMin,
}: {
  startAt?: string;
  active: boolean;
  durationMin?: number;
}) {
  const { formatted } = useLiveTimer(startAt, active && !!startAt);
  if (active && startAt) return <>{formatted || '—'}</>;
  return <>{formatDuration(durationMin)}</>;
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`z-card overflow-hidden flex flex-col min-h-0 ${className}`}>
      {children}
    </div>
  );
}

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-border/70 z-tint flex flex-wrap items-center justify-between gap-3 shrink-0">
      <h3 className="z-eyebrow">{title}</h3>
      {children}
    </div>
  );
}

export function PanelBody({ children, empty, emptyLabel = 'No data' }: { children: ReactNode; empty?: boolean; emptyLabel?: string }) {
  if (empty) {
    return <p className="text-sm text-muted-foreground py-10 text-center">{emptyLabel}</p>;
  }
  // ponytail: overflow stays here so sticky thead siblings outside VirtualizedList still work
  return <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>;
}

export function StatCell({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="px-4 py-3">
      <dt className="z-eyebrow">{label}</dt>
      <dd className={`mt-1 text-base font-bold text-foreground tabular-nums ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

export function liveRowFromQueue(o: MachineHeadDashboardData['orderQueue'][0]): LiveOrderRow {
  return o;
}

export function identityFromRow(r: {
  batchNumber: string;
  motherCoil?: string;
  coilNo?: string;
  slitId?: string;
}) {
  const coil = (r.motherCoil ?? r.coilNo ?? r.batchNumber).trim() || r.batchNumber;
  return {
    batchNumber: r.batchNumber,
    motherCoil: r.motherCoil ?? r.coilNo ?? coil,
    coilNo: r.coilNo ?? r.motherCoil ?? coil,
    slitId: r.slitId,
  };
}

export function liveRowFromHistory(h: MachineHeadDashboardData['productionHistory'][0], dashboard: MachineHeadDashboardData): LiveOrderRow {
  const match = dashboard.orderQueue.find((q) => q.batchNumber === h.batchNumber);
  const id = identityFromRow(h);
  return match ?? {
    batchNumber: h.batchNumber,
    customer: '—',
    grade: '—',
    machineCode: h.machineCode ?? '—',
    machineName: h.machineCode ?? '—',
    currentProcess: h.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling',
    status: 'COMPLETED',
    weightMt: h.weightMt,
    coilNo: id.coilNo,
    motherCoil: id.motherCoil,
    slitId: id.slitId,
  };
}

export function liveRowFromRejected(r: NonNullable<MachineHeadDashboardData['rejectedOrders']>[0] | RejectedOrderRow): LiveOrderRow {
  const id = identityFromRow(r);
  return {
    batchNumber: r.batchNumber,
    customer: '—',
    grade: '—',
    machineCode: r.machineCode,
    machineName: r.machineCode,
    currentProcess: r.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling',
    status: 'REJECTED',
    weightMt: r.weightMt,
    coilNo: id.coilNo,
    motherCoil: id.motherCoil,
    slitId: id.slitId,
    shiftCode: r.shiftCode,
  };
}

export function handoverCompletionLabel(h: {
  status: string;
  createdByBoundary?: boolean | null;
}): string {
  if (h.status === 'PENDING') return 'Pending';
  if (h.status === 'CLARIFICATION_REQUESTED') return 'Clarification';
  if (h.status === 'AUTO_COMPLETED' || h.createdByBoundary) return 'Auto completed';
  if (h.status === 'ACCEPTED') return 'Manual completed';
  return h.status;
}

export function orderRowClass(batchNumber: string, selectedBatch?: string | null) {
  return [
    'px-4 py-3 flex justify-between gap-2 items-center transition-colors cursor-pointer text-sm',
    selectedBatch === batchNumber ? 'bg-primary/10' : 'hover:bg-secondary',
  ].join(' ');
}
