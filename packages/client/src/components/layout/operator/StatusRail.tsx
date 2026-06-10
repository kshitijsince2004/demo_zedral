import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isCrmMillPath } from '../../../lib/millConfig';
import { formatShiftDate, formatShiftWindowTime } from '../../../lib/dateFormat';
import { Activity, CircleStop, Moon } from 'lucide-react';
import { useShiftStore } from '../../../store/shiftStore';
import { useAuthStore } from '../../../lib/authStore';
import { useSixHiStore } from '../../../store/sixHiStore';
import { useWorkspaceBase } from '../../../hooks/useWorkspaceBase';
import { ZBadge } from '../../primitives/ZBadge';
import { GloveModeToggle } from '../../ui/GloveModeToggle';
import type { Tone } from '../../../lib/tones';

interface StatusRailProps {
  processCode?: string;
}

export function StatusRail({ processCode }: StatusRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    shiftDate,
    shiftCode,
    detectedShift,
    processLine,
    targetMt,
    producedMt,
    runningStoppage,
    stoppages,
  } = useShiftStore();
  const username = useAuthStore((s) => s.username);

  const [clock, setClock] = useState('');
  const { basePath } = useWorkspaceBase();
  const { panelOrder, machineActive, processTab, machineCode } = useSixHiStore();
  const isCrmMill = isCrmMillPath(location.pathname);
  const line = isCrmMill ? machineCode : (processCode ?? processLine ?? 'HRS');
  const progressPct = targetMt > 0 ? Math.min((producedMt / targetMt) * 100, 100) : 0;
  const paceTone: Tone =
    progressPct >= 80 ? 'success' : progressPct >= 50 ? 'warning' : 'destructive';
  const totalStoppageMins = stoppages.reduce((sum, s) => sum + (s.durationMins || 0), 0);
  const activeBatch = machineActive?.batchNumber ?? panelOrder?.batchNumber;
  const activeStatus = panelOrder?.status ?? machineActive?.status;
  const processLabel = processTab === 'skinpass' ? 'Skin Pass' : 'Rolling';

  const crmStoppageActive = isCrmMill && !!panelOrder?.activeStoppage;
  const crmRunning = isCrmMill
    ? activeStatus === 'IN_PROGRESS' && !crmStoppageActive
    : !runningStoppage;

  const displayDate = formatShiftDate(shiftDate);
  const windowLabel = detectedShift
    ? `${formatShiftWindowTime(detectedShift.windowStart)}–${formatShiftWindowTime(detectedShift.windowEnd)}`
    : null;

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' IST',
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handoverPath = isCrmMill ? `${basePath}/handover` : '/handover';

  return (
    <header className="shrink-0 border-b border-border bg-background z-30 shadow-sm">
      <div className="flex items-stretch min-h-[52px]">
        <div className="flex items-center gap-3 px-4 border-r border-border min-w-[140px]">
          <span className="font-mono text-lg font-semibold tracking-tight text-primary">{line}</span>
          <div className="flex flex-col leading-none gap-0.5">
            <span className="z-rail-label">Shift</span>
            <span className="font-mono text-xs text-foreground">
              {detectedShift?.shiftName ?? `Shift ${shiftCode}`}
              {detectedShift?.source === 'OVERRIDE' ? ' *' : ''}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {displayDate} · {shiftCode}
              {windowLabel ? ` · ${windowLabel}` : ''}
            </span>
            {isCrmMill && (
              <span className="text-[10px] text-muted-foreground mt-0.5">
                {processLabel}
                {username ? ` · ${username}` : ''}
              </span>
            )}
          </div>
        </div>

        {isCrmMill && (
          <div className="hidden md:flex flex-col gap-0.5 px-4 border-r border-border min-w-[120px]">
            <span className="z-rail-label">Active Order</span>
            <span className="font-mono text-xs text-foreground truncate max-w-[180px]">
              {activeBatch ?? '—'}
            </span>
            {activeStatus && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {activeStatus.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        )}

        {!isCrmMill && (
          <div className="flex-1 flex items-center gap-4 px-4 border-r border-border min-w-0">
            <div className="flex flex-col gap-1 min-w-[120px]">
              <span className="z-rail-label">Produced</span>
              <span className="font-mono text-sm">
                <span className="text-foreground">{producedMt.toFixed(1)}</span>
                <span className="text-muted-foreground"> / {targetMt} Metric Tons</span>
              </span>
            </div>
            <div className="flex-1 max-w-md">
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    paceTone === 'success'
                      ? 'bg-success'
                      : paceTone === 'warning'
                        ? 'bg-warning'
                        : 'bg-destructive'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground mt-0.5 block">
                {progressPct.toFixed(0)}% of shift target
              </span>
            </div>
            <div className="hidden md:flex flex-col gap-0.5">
              <span className="z-rail-label">Stoppage</span>
              <span className="font-mono text-xs text-muted-foreground">{totalStoppageMins} minutes</span>
            </div>
          </div>
        )}

        {isCrmMill && <div className="flex-1 min-w-0" />}

        <div className="flex items-center gap-3 px-4">
          {crmStoppageActive || runningStoppage ? (
            <ZBadge tone="destructive" label="STOPPED" dot />
          ) : crmRunning || !isCrmMill ? (
            <ZBadge tone="success" label="Running" dot />
          ) : (
            <ZBadge tone="muted" label="Idle" dot />
          )}
          <div className="hidden sm:flex items-center gap-1.5 text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-info" aria-hidden />
            <span className="text-[10px] uppercase tracking-[0.12em] font-medium">Live</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground tabular-nums hidden lg:block">
            {clock}
          </span>
          <GloveModeToggle />
          <button
            type="button"
            onClick={() => navigate(handoverPath)}
            className="h-10 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-bold uppercase tracking-wide shadow-sm hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            <Moon className="h-4 w-4" aria-hidden />
            End Shift
          </button>
        </div>
      </div>

      {(crmStoppageActive || runningStoppage) && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <CircleStop className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">
            {crmStoppageActive && panelOrder?.activeStoppage
              ? `${panelOrder.activeStoppage.categoryLabel} — since ${new Date(panelOrder.activeStoppage.startAt).toLocaleTimeString()}`
              : runningStoppage
                ? `${runningStoppage.reason} — since ${runningStoppage.fromTime}`
                : 'Stoppage active'}
          </span>
        </div>
      )}
    </header>
  );
}
