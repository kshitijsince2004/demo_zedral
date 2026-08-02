import type { ComponentType } from 'react';
import { AlertTriangle, Ban, Clock, MessageSquare, Play, Square } from 'lucide-react';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { HOLD_ACTION_LABEL } from '../../lib/orderLabels';
import { processRailFlags } from '../../lib/processRailFlags';

export interface ProcessActionRailProps {
  coilNo: string;
  status: 'idle' | 'running' | 'stoppage';
  stoppageStartedAt?: string;
  runStartedAt?: string;
  busy?: boolean;
  onStart: () => void;
  onEnd: () => void;
  onStoppage: () => void;
  onRemark: () => void;
  onHold: () => void;
  onEndShift?: () => void;
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
  variant?: 'start' | 'end' | 'stoppage' | 'hold' | 'default';
}) {
  const styles = {
    start: 'bg-primary text-white border-primary hover:bg-[#1f4a3a]',
    end: 'bg-[#DC2626] text-white border-destructive hover:bg-[#B91C1C]',
    stoppage: 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20',
    hold: 'bg-white text-warning border-[#FDBA74]',
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

/**
 * 6HI-parity: Start becomes End when running; Stoppage shows Resume (not End+Resume).
 * Stack: [Start|Resume|End] · Stoppage · Remark · Hold + footer timer.
 */
export function ProductionActionRail({
  coilNo,
  status,
  stoppageStartedAt,
  runStartedAt,
  busy,
  onStart,
  onEnd,
  onStoppage,
  onRemark,
  onHold,
}: ProcessActionRailProps) {
  const f = processRailFlags(status, coilNo);
  const { formatted: timer } = useLiveTimer(
    f.isStoppage ? stoppageStartedAt : f.isRunning ? runStartedAt : undefined,
    f.isRunning || f.isStoppage,
  );

  return (
    <aside
      className="fixed right-0 top-[52px] bottom-0 z-[100] w-[6.5rem] border-l border-border bg-white flex flex-col shadow-[-4px_0_24px_rgba(22,51,40,0.08)]"
      aria-label="Production controls"
    >
      <div className="shrink-0 px-1.5 py-2 border-b border-border text-center">
        <p className="font-mono text-sm font-bold text-foreground leading-tight break-all" title={coilNo}>
          {coilNo || '—'}
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-center gap-2 px-2 py-3 min-h-0 overflow-y-auto">
        {f.canStart && (
          <RailButton label="Start" icon={Play} onClick={onStart} disabled={busy} variant="start" />
        )}
        {f.canResume && (
          <RailButton label="Resume" icon={Play} onClick={onStart} disabled={busy} variant="start" />
        )}
        {f.canEnd && (
          <RailButton label="End" icon={Square} onClick={onEnd} disabled={busy} variant="end" />
        )}
        <RailButton
          label={f.isStoppage ? 'Manage Stop' : 'Stoppage'}
          icon={AlertTriangle}
          onClick={onStoppage}
          disabled={busy || (!f.isRunning && !f.isStoppage)}
          variant={f.isStoppage ? 'stoppage' : 'default'}
        />
        <RailButton label="Remark" icon={MessageSquare} onClick={onRemark} disabled={busy} />
        <RailButton
          label={HOLD_ACTION_LABEL}
          icon={Ban}
          onClick={onHold}
          disabled={busy || !coilNo}
          variant="hold"
        />
      </div>

      <div className="shrink-0 px-2 py-3 border-t border-border space-y-2 text-center">
        {f.isStoppage ? (
          <div className="space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-destructive">Stoppage</p>
            <p className="font-mono text-lg font-bold text-destructive">{timer || '00:00:00'}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <span className="font-mono text-sm font-bold text-foreground">
              {timer || '00:00:00'}
            </span>
          </div>
        )}
        <span className={[
          'block text-[11px] font-bold uppercase tracking-wide px-1.5 py-1.5 rounded',
          f.machineStatus === 'Running' ? 'bg-primary text-primary-foreground' :
          f.machineStatus === 'Stopped' ? 'bg-destructive text-destructive-foreground' :
          'bg-secondary text-muted-foreground',
        ].join(' ')}>
          {f.machineStatus}
        </span>
      </div>
    </aside>
  );
}
