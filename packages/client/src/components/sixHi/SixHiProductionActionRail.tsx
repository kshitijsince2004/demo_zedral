import type { ComponentType } from 'react';
import { AlertTriangle, Ban, Clock, MessageSquare, Play, Square } from 'lucide-react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { SixHiStatusPill } from './SixHiStatusPill';
import { isPreparing } from '../../store/sixHiStore';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { canRecordStoppage } from '../../lib/sixHiRuntime';

interface SixHiProductionActionRailProps {
  order: SixHiOrderDetail;
  workspaceOpen: boolean;
  workspaceBatch: string | null;
  busy?: boolean;
  onStart: () => void;
  onEnd: () => void;
  onRemark: () => void;
  onReject: () => void;
  onStoppage: () => void;
}

function RailButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  variant = 'default',
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'start' | 'end' | 'warn' | 'stoppage' | 'default';
}) {
  const styles = {
    start: 'bg-primary text-white border-primary hover:bg-[#1f4a3a]',
    end: 'bg-[#DC2626] text-white border-destructive hover:bg-[#B91C1C]',
    warn: 'bg-white text-warning border-[#FDBA74]',
    stoppage: 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20',
    reject: 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100',
    default: 'bg-white text-foreground border-border hover:bg-secondary',
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'w-full min-h-[5rem] rounded-xl border flex flex-col items-center justify-center gap-1.5 px-1 py-2',
        'transition-colors disabled:opacity-40 disabled:pointer-events-none',
        styles,
      ].join(' ')}
    >
      <Icon className="h-6 w-6 shrink-0" aria-hidden />
      <span className="text-[11px] font-bold uppercase tracking-wide leading-tight text-center">{label}</span>
    </button>
  );
}

export function SixHiProductionActionRail({
  order,
  workspaceOpen,
  workspaceBatch,
  busy,
  onStart,
  onEnd,
  onRemark,
  onReject,
  onStoppage,
}: SixHiProductionActionRailProps) {
  const preparing = isPreparing(order, workspaceOpen, workspaceBatch);
  const hasActiveStoppage = !!order.activeStoppage;
  const stoppageAllowed = canRecordStoppage(order);
  const canStart = (order.status === 'PENDING' || order.status === 'PREPARING') && !hasActiveStoppage;
  const canResume = order.status === 'STOPPAGE' && !hasActiveStoppage;
  const canEnd = order.status === 'IN_PROGRESS' || canResume;
  const canReject = order.status !== 'COMPLETED' && order.status !== 'REJECTED';

  const { formatted: stoppageTimer } = useLiveTimer(order.activeStoppage?.startAt, hasActiveStoppage);

  const runtimeLabel = order.prodDurationMin
    ? `${order.prodDurationMin} minutes`
    : order.prodStartAt
      ? 'Running'
      : preparing
        ? 'Preparing'
        : '—';

  const machineStatus = hasActiveStoppage
    ? 'Stopped'
    : order.status === 'IN_PROGRESS'
      ? 'Running'
      : preparing
        ? 'Preparing'
        : 'Idle';

  return (
    <aside
      className="w-[6.5rem] shrink-0 border-l border-border bg-white flex flex-col h-full"
      aria-label="Production controls"
    >
      <div className="shrink-0 px-1.5 py-2 border-b border-border text-center space-y-1">
        <p className="font-mono text-sm font-bold text-foreground leading-tight break-all">
          {order.batchNumber.slice(-6)}
        </p>
        <SixHiStatusPill status={order.status} preparing={preparing} />
      </div>

      <div className="flex-1 flex flex-col justify-center gap-2 px-2 py-3 min-h-0 overflow-y-auto">
        {canStart && (
          <RailButton label="Start" icon={Play} onClick={onStart} disabled={busy} variant="start" />
        )}
        {canResume && (
          <RailButton label="Resume" icon={Play} onClick={onStart} disabled={busy} variant="start" />
        )}
        {canEnd && (
          <RailButton label="End" icon={Square} onClick={onEnd} disabled={busy} variant="end" />
        )}
        <RailButton
          label={hasActiveStoppage ? 'Manage Stop' : 'Stoppage'}
          icon={AlertTriangle}
          onClick={onStoppage}
          disabled={busy || !stoppageAllowed}
          variant={hasActiveStoppage ? 'stoppage' : 'default'}
        />
        <RailButton label="Remark" icon={MessageSquare} onClick={onRemark} disabled={busy} />
        {canReject && (
          <RailButton label="Reject" icon={Ban} onClick={onReject} disabled={busy} variant="warn" />
        )}
      </div>

      <div className="shrink-0 px-2 py-3 border-t border-border space-y-2 text-center">
        {hasActiveStoppage ? (
          <div className="space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-destructive">Stoppage</p>
            <p className="font-mono text-lg font-bold text-destructive">{stoppageTimer}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <span className="font-mono text-sm font-bold">{runtimeLabel}</span>
          </div>
        )}
        <span className={[
          'block text-[11px] font-bold uppercase tracking-wide px-1.5 py-1.5 rounded',
          machineStatus === 'Running' ? 'bg-success/15 text-success' :
          machineStatus === 'Stopped' ? 'bg-destructive/10 text-destructive' :
          machineStatus === 'Preparing' ? 'bg-info/15 text-info' :
          'bg-secondary text-muted-foreground',
        ].join(' ')}>
          {machineStatus}
        </span>
      </div>
    </aside>
  );
}
