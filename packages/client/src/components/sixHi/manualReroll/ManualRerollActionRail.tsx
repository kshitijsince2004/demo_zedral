import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, Clock, LayoutPanelLeft, MessageSquare, Play, Square } from 'lucide-react';
import { getServerTime } from '../../../lib/apiClient';
import { formatDuration } from '../../../hooks/useLiveTimer';
import { HOLD_ACTION_LABEL } from '../../../lib/orderLabels';
import {
  formatRerollNetRuntime,
  rerollNetRuntimeMs,
} from '../../../lib/manualRerollUi';
import { StoppageTimerText } from '../ProductionTimerDisplay';
import type { ManualRerollSession, ManualRerollStoppage } from '../../../services/manualRerollService';

interface ManualRerollActionRailProps {
  session: ManualRerollSession | null;
  pendingLabel?: string | null;
  pendingCount?: number;
  pendingWeightMt?: number | null;
  /** Pending selected — Move to Preparing. */
  canPrepare?: boolean;
  /** PREPARING session — Start production. */
  canStart?: boolean;
  busy?: boolean;
  canWrite?: boolean;
  onPrepare: () => void;
  onStart: () => void;
  onEnd: () => void;
  onHold: () => void;
  onRemark: () => void;
  onStoppage: () => void;
  onOpenConsole?: () => void;
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

function NetRuntimeText({
  startTime,
  stoppages,
  active,
  className,
}: {
  startTime: string;
  stoppages?: ManualRerollStoppage[];
  active: boolean;
  className?: string;
}) {
  const [label, setLabel] = useState('—');
  useEffect(() => {
    if (!active) {
      setLabel('—');
      return;
    }
    const tick = () => {
      setLabel(formatRerollNetRuntime(rerollNetRuntimeMs(startTime, stoppages, getServerTime())));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, startTime, stoppages]);
  return <span className={className}>{label}</span>;
}

export function ManualRerollActionRail({
  session,
  pendingLabel,
  pendingCount = 0,
  pendingWeightMt,
  canPrepare,
  canStart,
  busy,
  canWrite = true,
  onPrepare,
  onStart,
  onEnd,
  onHold,
  onRemark,
  onStoppage,
  onOpenConsole,
}: ManualRerollActionRailProps) {
  const status = session?.status ?? null;
  const hasActiveStoppage = !!session?.activeStoppage;
  const preparing = status === 'PREPARING';
  const running = status === 'IN_PROGRESS';
  const stopped = status === 'STOPPAGE' || hasActiveStoppage;
  const held = status === 'ON_HOLD';
  const open = preparing || running || stopped || held;
  const combinedActive = (session?.batchNumbers?.length ?? 0) > 1;
  const combinedPending = !session && pendingCount > 1;

  const machineStatus = stopped
    ? 'Stopped'
    : running
      ? 'Running'
      : held
        ? 'Held'
        : preparing
          ? 'Preparing'
          : canPrepare
            ? 'Ready'
            : 'Idle';

  const title = session
    ? (session.batchNumbers?.length ? session.batchNumbers.join(' · ') : session.batchNumber) ?? '—'
    : pendingLabel ?? '—';

  const statusChip = status === 'PREPARING'
    ? 'PREPARING'
    : status ?? (canPrepare ? 'PENDING' : 'IDLE');

  return (
    <aside
      className="w-[6.5rem] shrink-0 border-l border-border bg-white flex flex-col h-full"
      aria-label="Re-roll production controls"
    >
      <div className="shrink-0 px-1.5 py-2 border-b border-border text-center space-y-1">
        {(combinedPending || combinedActive) ? (
          <>
            <p className="text-[9px] font-bold uppercase tracking-wide text-success">Combined</p>
            <p className="font-mono text-xs font-bold text-foreground leading-tight">
              {session?.batchNumbers?.length ?? pendingCount} orders
            </p>
            {(session?.rerollQuantity != null || pendingWeightMt != null) && (
              <p className="font-mono text-[10px] text-muted-foreground">
                Σ {(session?.rerollQuantity ?? pendingWeightMt ?? 0).toFixed(2)} MT
              </p>
            )}
          </>
        ) : (
          <p className="font-mono text-sm font-bold text-foreground leading-tight break-all">{title}</p>
        )}
        <span className="inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
          {statusChip}
        </span>
      </div>

      <div className="flex-1 flex flex-col justify-center gap-2 px-2 py-3 min-h-0 overflow-y-auto">
        {canWrite && canPrepare && !open && (
          <RailButton label="Preparing" icon={Play} onClick={onPrepare} disabled={busy} variant="start" />
        )}
        {canWrite && preparing && (
          <RailButton label="Start" icon={Play} onClick={onStart} disabled={busy} variant="start" />
        )}
        {canWrite && open && onOpenConsole && (
          <RailButton label="Console" icon={LayoutPanelLeft} onClick={onOpenConsole} disabled={busy} />
        )}
        {canWrite && open && !held && !preparing && (
          <RailButton label="End" icon={Square} onClick={onEnd} disabled={busy} variant="end" />
        )}
        {canWrite && (running || stopped) && (
          <RailButton
            label={hasActiveStoppage ? 'Manage Stop' : 'Stoppage'}
            icon={AlertTriangle}
            onClick={onStoppage}
            disabled={busy || held}
            variant={hasActiveStoppage ? 'stoppage' : 'default'}
          />
        )}
        {canWrite && open && !held && !preparing && (
          <RailButton label="Remark" icon={MessageSquare} onClick={onRemark} disabled={busy} />
        )}
        {canWrite && running && (
          <RailButton
            label={HOLD_ACTION_LABEL}
            icon={Ban}
            onClick={onHold}
            disabled={busy || hasActiveStoppage}
            variant="warn"
          />
        )}
        {held && (
          <p className="text-[10px] text-center text-muted-foreground px-1 leading-snug">
            On hold — use detail panel to move to Pending
          </p>
        )}
      </div>

      <div className="shrink-0 px-2 py-3 border-t border-border space-y-2 text-center">
        {hasActiveStoppage && session?.activeStoppage ? (
          <div className="space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-destructive">Stoppage</p>
            <StoppageTimerText
              startAt={session.activeStoppage.startTime}
              active
              className="font-mono text-lg font-bold text-destructive"
            />
          </div>
        ) : session && open && !preparing ? (
          <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <NetRuntimeText
              startTime={session.startTime}
              stoppages={session.stoppages}
              active={open && !held}
              className="font-mono text-sm font-bold"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <span className="font-mono text-sm font-bold">{formatDuration(0)}</span>
          </div>
        )}
        <span className={[
          'block text-[11px] font-bold uppercase tracking-wide px-1.5 py-1.5 rounded',
          machineStatus === 'Running' ? 'bg-primary text-primary-foreground' :
          machineStatus === 'Stopped' ? 'bg-destructive text-destructive-foreground' :
          machineStatus === 'Held' ? 'bg-warning text-white' :
          machineStatus === 'Preparing' ? 'bg-info text-white' :
          machineStatus === 'Ready' ? 'bg-info text-white' :
          'bg-secondary text-muted-foreground',
        ].join(' ')}>
          {machineStatus}
        </span>
      </div>
    </aside>
  );
}
