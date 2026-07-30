import type { ComponentType } from 'react';
import { AlertTriangle, Ban, Clock, Play, Square, Users } from 'lucide-react';
import { useLiveTimer } from '../../hooks/useLiveTimer';

export interface ProcessActionRailProps {
  coilNo: string;
  status: 'idle' | 'running' | 'stoppage';
  stoppageStartedAt?: string;
  runStartedAt?: string;
  busy?: boolean;
  onStart: () => void;
  onStop: () => void;
  onDefect: () => void;
  onCrew: () => void;
  onEndEntry: () => void;
  onEndShift: () => void;
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
  variant?: 'start' | 'end' | 'stoppage' | 'default';
}) {
  const styles = {
    start: 'bg-primary text-white border-primary hover:bg-[#1f4a3a]',
    end: 'bg-[#DC2626] text-white border-destructive hover:bg-[#B91C1C]',
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

export function ProductionActionRail({
  coilNo,
  status,
  stoppageStartedAt,
  runStartedAt,
  busy,
  onStart,
  onStop,
  onDefect,
  onCrew,
  onEndEntry,
  onEndShift,
}: ProcessActionRailProps) {
  const isRunning = status === 'running';
  const isStoppage = status === 'stoppage';
  const timer = useLiveTimer(isStoppage ? stoppageStartedAt : isRunning ? runStartedAt : undefined);

  return (
    <aside className="fixed right-0 top-0 bottom-0 w-[5.5rem] z-30 bg-background/95 border-l border-border flex flex-col gap-2 p-2 pt-20">
      {(isRunning || isStoppage) && (
        <div
          className={[
            'rounded-lg px-2 py-2 text-center text-[10px] font-bold uppercase',
            isStoppage ? 'bg-destructive/10 text-destructive' : 'bg-emerald-50 text-emerald-700',
          ].join(' ')}
        >
          <Clock className="h-4 w-4 mx-auto mb-1" />
          {timer}
        </div>
      )}

      <p className="text-[9px] text-center text-muted-foreground truncate px-1" title={coilNo}>
        {coilNo || '—'}
      </p>

      <RailButton label="Start" icon={Play} onClick={onStart} disabled={busy || isRunning} variant="start" />
      <RailButton label="Stop" icon={Ban} onClick={onStop} disabled={busy || !isRunning} variant="stoppage" />
      <RailButton label="Defect" icon={AlertTriangle} onClick={onDefect} disabled={busy} variant="default" />
      <RailButton label="Crew" icon={Users} onClick={onCrew} disabled={busy} variant="default" />
      <RailButton label="End Entry" icon={Square} onClick={onEndEntry} disabled={busy} variant="end" />
      <RailButton label="End Shift" icon={Square} onClick={onEndShift} disabled={busy} variant="default" />
    </aside>
  );
}
