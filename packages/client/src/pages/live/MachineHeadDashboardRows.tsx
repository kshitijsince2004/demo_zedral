// PERF-B1 — memoized list/table rows for MachineHeadDashboard
import { memo } from 'react';
import type {
  HandoverOverviewRow,
  LiveOrderRow,
  MachineHeadDashboardData,
  MachineHeadOperatorRow,
  MachineHeadProductionRow,
  MachineHeadStoppageRow,
  RejectedOrderRow,
} from '@m1/shared-validation';
import { AlertTriangle } from 'lucide-react';
import { OrderIdentityDisplay } from '../../components/orders/OrderIdentityDisplay';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { formatOrderProcessLabel, formatOrderStatusLabel, formatProcessFilterLabel } from '../../lib/orderLabels';
import {
  type HistoryRow,
  StoppageDurationCell,
  formatDuration,
  handoverCompletionLabel,
  identityFromRow,
  liveRowFromHistory,
  liveRowFromRejected,
  orderRowClass,
} from './MachineHeadDashboardPanels';

export const QueueOrderRow = memo(function QueueOrderRow({
  o,
  onSelectOrder,
}: {
  o: LiveOrderRow;
  onSelectOrder: (o: LiveOrderRow) => void;
}) {
  return (
    <tr
      className="hover:bg-secondary/50 cursor-pointer transition-colors"
      onClick={() => onSelectOrder(o)}
      onKeyDown={(e) => e.key === 'Enter' && onSelectOrder(o)}
      role="button"
      tabIndex={0}
    >
      <td className="px-4 py-3 text-sm">
        <OrderIdentityDisplay order={o} size="sm" />
      </td>
      <td className="px-4 py-3 text-sm truncate max-w-[12rem] text-muted-foreground">{o.customer || '—'}</td>
      <td className="px-4 py-3 text-sm font-medium">
        {formatOrderProcessLabel(o.subProcess, o.currentProcess)}
      </td>
      <td className="px-4 py-3 text-sm font-mono tabular-nums">{o.weightMt} MT</td>
      <td className="px-4 py-3 text-sm">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
          o.status === 'RUNNING' || o.status === 'IN_PROGRESS'
            ? 'bg-success/10 text-success'
            : 'bg-primary/10 text-primary'
        }`}>
          {formatOrderStatusLabel(o.status)}
        </span>
      </td>
    </tr>
  );
});

export const ProductionHistoryRow = memo(function ProductionHistoryRow({
  h,
  selectedBatch,
  dashboard,
  onSelectOrder,
}: {
  h: MachineHeadProductionRow;
  selectedBatch?: string | null;
  dashboard: MachineHeadDashboardData;
  onSelectOrder: (row: LiveOrderRow) => void;
}) {
  return (
    <li
      className={orderRowClass(h.batchNumber, selectedBatch)}
      onClick={() => onSelectOrder(liveRowFromHistory(h, dashboard))}
      role="button"
      tabIndex={0}
    >
      <span className="min-w-0 flex-1">
        <OrderIdentityDisplay order={identityFromRow(h)} size="sm" />
      </span>
      <span className="font-mono">{h.weightMt} MT</span>
      <span className="text-muted-foreground">{formatPlantDateTime(h.completedAt)}</span>
    </li>
  );
});

export const OperatorActivityRow = memo(function OperatorActivityRow({
  a,
  selectedBatch,
  dashboard,
  onSelectOrder,
}: {
  a: MachineHeadOperatorRow;
  selectedBatch?: string | null;
  dashboard: MachineHeadDashboardData;
  onSelectOrder: (row: LiveOrderRow) => void;
}) {
  return (
    <li
      className={orderRowClass(a.batchNumber, selectedBatch)}
      onClick={() => {
        const match = dashboard.orderQueue.find((q) => q.batchNumber === a.batchNumber);
        const id = identityFromRow(a);
        onSelectOrder(match ?? {
          batchNumber: a.batchNumber,
          customer: '—',
          grade: '—',
          machineCode: a.machineCode ?? '—',
          machineName: a.machineCode ?? '—',
          currentProcess: a.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling',
          operatorName: a.operatorName,
          status: a.status as LiveOrderRow['status'],
          weightMt: 0,
          coilNo: id.coilNo,
          motherCoil: id.motherCoil,
          slitId: id.slitId,
        });
      }}
      role="button"
      tabIndex={0}
    >
      <span className="font-semibold">{a.operatorName}</span>
      <span className="min-w-0 flex-1">
        <OrderIdentityDisplay order={identityFromRow(a)} size="sm" />
      </span>
      <span className="text-muted-foreground">{formatOrderStatusLabel(a.status)}</span>
    </li>
  );
});

export const StoppageRow = memo(function StoppageRow({
  s,
  dashboard,
  onSelectOrder,
}: {
  s: MachineHeadStoppageRow;
  dashboard: MachineHeadDashboardData;
  onSelectOrder: (row: LiveOrderRow) => void;
}) {
  const isActive = s.status === 'ACTIVE';
  return (
    <tr
      className="hover:bg-secondary/50 cursor-pointer transition-colors"
      onClick={() => {
        const match = dashboard.orderQueue.find((q) => q.batchNumber === s.batchNumber);
        const id = identityFromRow(s);
        onSelectOrder(match ?? {
          batchNumber: s.batchNumber,
          customer: '—',
          grade: '—',
          machineCode: s.machineCode,
          machineName: s.machineCode,
          currentProcess: '—',
          status: 'STOPPAGE',
          weightMt: 0,
          coilNo: id.coilNo,
          motherCoil: id.motherCoil,
          slitId: id.slitId,
        });
      }}
    >
      <td className="px-4 py-3 text-sm font-mono font-bold">{s.machineCode}</td>
      <td className="px-4 py-3 text-sm">
        <OrderIdentityDisplay order={identityFromRow(s)} size="sm" />
      </td>
      <td className="px-4 py-3 text-sm">
        <div className={`font-medium ${isActive ? 'text-destructive' : 'text-foreground'}`}>{s.category}</div>
        {s.remarks && <div className="text-xs text-muted-foreground">{s.remarks}</div>}
      </td>
      <td className="px-4 py-3 text-sm font-mono tabular-nums text-muted-foreground">
        {s.startAt ? formatPlantDateTime(s.startAt) : '—'}
      </td>
      <td className={`px-4 py-3 text-sm font-mono tabular-nums ${isActive ? 'text-warning' : 'text-muted-foreground'}`}>
        <StoppageDurationCell
          startAt={s.startAt}
          active={isActive}
          durationMin={s.durationMin}
        />
      </td>
      <td className="px-4 py-3 text-sm font-medium">
        {isActive ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive">
            Active
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
            Ended{s.endAt ? ` · ${formatPlantDateTime(s.endAt)}` : ''}
          </span>
        )}
      </td>
    </tr>
  );
});

export const RejectedOrderListRow = memo(function RejectedOrderListRow({
  r,
  selectedBatch,
  onSelectOrder,
}: {
  r: RejectedOrderRow | NonNullable<MachineHeadDashboardData['rejectedOrders']>[0];
  selectedBatch?: string | null;
  onSelectOrder: (row: LiveOrderRow) => void;
}) {
  return (
    <li
      className={`${orderRowClass(r.batchNumber, selectedBatch)} flex-col items-stretch`}
      onClick={() => onSelectOrder(liveRowFromRejected(r))}
      role="button"
      tabIndex={0}
    >
      <div className="flex justify-between w-full gap-2">
        <OrderIdentityDisplay order={identityFromRow(r)} size="sm" className="min-w-0" />
        <span className="font-mono font-bold text-destructive shrink-0">{r.weightMt} MT</span>
      </div>
      <div className="flex gap-2 items-start mt-1 w-full">
        <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
        <div>
          <p>{r.reason}</p>
          <p className="text-muted-foreground mt-0.5">
            Held by {r.rejectedBy} · {formatPlantDateTime(r.rejectionTime)}
          </p>
        </div>
      </div>
    </li>
  );
});

export const CompletedHistoryRow = memo(function CompletedHistoryRow({
  o,
  onSelectOrder,
}: {
  o: HistoryRow;
  onSelectOrder: (row: LiveOrderRow) => void;
}) {
  return (
    <tr
      className={[
        'transition-colors',
        o.kind === 'CRM' ? 'hover:bg-secondary/50 cursor-pointer' : 'hover:bg-secondary/30',
      ].join(' ')}
      onClick={() => {
        if (o.kind !== 'CRM') return;
        const id = identityFromRow(o);
        onSelectOrder({
          batchNumber: o.batchNumber,
          customer: o.customer ?? '—',
          grade: o.grade ?? '—',
          machineCode: o.machineCode ?? '—',
          machineName: o.machineCode ?? '—',
          currentProcess: formatOrderProcessLabel(o.subProcess),
          operatorName: o.operatorName,
          status: 'COMPLETED',
          weightMt: o.weightMt ?? 0,
          coilNo: id.coilNo,
          motherCoil: id.motherCoil,
          slitId: id.slitId,
          subProcess: o.subProcess === 'SKIN_PASS' ? 'SKIN_PASS' : 'ROLLING',
        });
      }}
    >
      <td className="px-4 py-3 text-sm">
        {o.kind === 'CRM' ? (
          <OrderIdentityDisplay order={identityFromRow(o)} size="sm" />
        ) : (
          <span className="font-mono text-xs font-bold text-foreground">{o.batchNumber}</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm font-medium">
        {o.subProcess === 'MANUAL_REROLL'
          ? formatProcessFilterLabel('MANUAL_REROLL')
          : formatOrderProcessLabel(o.subProcess)}
      </td>
      <td className="px-4 py-3 text-sm font-mono font-bold">{o.machineCode ?? '—'}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground truncate max-w-[12rem]">{o.customer ?? '—'}</td>
      <td className="px-4 py-3 text-sm font-mono tabular-nums font-bold">
        {o.weightMt != null ? `${o.weightMt} MT` : '—'}
      </td>
      <td className="px-4 py-3 text-sm font-mono tabular-nums text-muted-foreground">{o.prodEndAt ? formatPlantDateTime(o.prodEndAt) : '—'}</td>
    </tr>
  );
});

export const HandoverListRow = memo(function HandoverListRow({
  h,
}: {
  h: HandoverOverviewRow;
}) {
  return (
    <li className="px-4 py-3 hover:bg-secondary/50">
      <div className="flex justify-between mb-1 gap-2">
        <span className="font-bold">{h.machineCode}</span>
        <span className="text-muted-foreground font-mono shrink-0">
          {h.prodDate ? `${h.prodDate} · ` : ''}Shift {h.outgoingShiftCode} → {h.incomingShiftCode}
          {' · '}
          <span
            className={
              h.status === 'PENDING'
                ? 'text-amber-700'
                : h.status === 'AUTO_COMPLETED' || h.createdByBoundary
                  ? 'text-sky-700'
                  : h.status === 'ACCEPTED'
                    ? 'text-emerald-700'
                    : undefined
            }
          >
            {handoverCompletionLabel(h)}
          </span>
        </span>
      </div>
      <p className="text-muted-foreground mb-1">
        Out: {h.outgoingUsername ?? '—'}
        {' · '}
        In: {h.incomingUsername
          ?? (h.status === 'AUTO_COMPLETED' || h.createdByBoundary
            ? 'SYSTEM'
            : h.status === 'PENDING'
              ? 'Awaiting accept'
              : '—')}
      </p>
      {h.batchNumber ? (
        <div className="mb-1">
          <OrderIdentityDisplay order={identityFromRow({
            batchNumber: h.batchNumber,
            motherCoil: h.motherCoil,
            coilNo: h.coilNo,
            slitId: h.slitId,
          })} size="sm" />
        </div>
      ) : (
        <p className="text-muted-foreground">Machine handover</p>
      )}
      {h.subProcess && (
        <p className="text-muted-foreground">
          {h.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Cold Rolling'}
        </p>
      )}
      <p className="text-muted-foreground">
        Start {formatPlantDateTime(h.shiftStartAt ?? h.createdAt)}
        {h.shiftEndAt ? ` · End ${formatPlantDateTime(h.shiftEndAt)}` : ''}
        {h.shiftDurationMinutes != null ? ` · ${h.shiftDurationLabel ?? formatDuration(h.shiftDurationMinutes)}` : ''}
      </p>
      {h.remarks && (
        <p className="mt-1 text-foreground/80 whitespace-pre-wrap">{h.remarks}</p>
      )}
    </li>
  );
});
