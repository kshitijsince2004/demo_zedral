import { memo, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isCrmMillPath } from '../../../lib/millConfig';
import { isProcessStationCode } from '../../../lib/processConfig';
import { CircleStop, Moon, PauseCircle } from 'lucide-react';
import { useShiftStore } from '../../../store/shiftStore';
import { useSixHiStore } from '../../../store/sixHiStore';
import { useProcessStore } from '../../../store/processStore';
import { useWorkspaceBase } from '../../../hooks/useWorkspaceBase';
import { ZBadge } from '../../primitives/ZBadge';
import { SyncStatusBadge } from '../../../lib/sync/SyncStatusBadge';
import { DeviceStatusIndicators } from './DeviceStatusIndicators';
import { formatPlantClock } from '../../../lib/dateFormat';
import { subscribeTimerTick } from '../../../hooks/useTimerTick';

const RailClock = memo(function RailClock() {
  const [clock, setClock] = useState('');
  const [currentDateStr, setCurrentDateStr] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(
        now.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' IST',
      );
      setCurrentDateStr(
        now.toLocaleDateString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
      );
    };
    tick();
    return subscribeTimerTick(tick);
  }, []);

  return (
    <span className="font-mono text-xs text-muted-foreground tabular-nums hidden lg:block">
      {currentDateStr} {clock}
    </span>
  );
});

interface StatusRailProps {
  processCode?: string;
  onManualStoppage?: () => void;
  onShiftReadings?: () => void;
  /** PKL idle-machine manual stoppage (StatusRail Manual Stop). */
  processManualStoppage?: {
    eligible: boolean;
    active: { startedAt: string; categoryLabel?: string } | null;
  } | null;
}

export function StatusRail({ processCode, onManualStoppage, onShiftReadings, processManualStoppage }: StatusRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    processLine,
    runningStoppage,
    detectedShift,
    shiftCode,
  } = useShiftStore();

  const { basePath } = useWorkspaceBase();
  const panelOrder = useSixHiStore((s) => s.panelOrder);
  const machineActive = useSixHiStore((s) => s.machineActive);
  const machineCode = useSixHiStore((s) => s.machineCode);
  const manualStoppage = useSixHiStore((s) => s.manualStoppage);
  const captureStatus = useProcessStore((s) => s.captureStatus);
  const stoppageStartedAt = useProcessStore((s) => s.stoppageStartedAt);
  const stoppageCode = useProcessStore((s) => s.stoppageCode);
  const stoppageRemarks = useProcessStore((s) => s.stoppageRemarks);
  // ponytail: process stations on user-scope URLs are not CRM (debug H-F)
  const isProcess = !!(processCode && isProcessStationCode(processCode));
  const isCrmMill = !isProcess && isCrmMillPath(location.pathname);
  const lineCode = isCrmMill ? machineCode : (processCode ?? processLine ?? 'HRS');
  const line =
    isProcess
      ? processCode
      : lineCode;
  const processOrderStoppage = isProcess && captureStatus === 'stoppage' && !!stoppageStartedAt;
  const activeBatch = machineActive?.batchNumber ?? panelOrder?.batchNumber;
  const activeStatus = panelOrder?.status ?? machineActive?.status;


  const crmStoppageActive = isCrmMill && (!!panelOrder?.activeStoppage || !!manualStoppage?.active
    || machineActive?.status === 'STOPPAGE');
  const manualStoppageEligible = isCrmMill && !!manualStoppage?.eligible && !manualStoppage?.active;
  const manualStoppageActive = isCrmMill && !!manualStoppage?.active;
  const pklManualEligible = processCode === 'PKL' && !!processManualStoppage?.eligible && !processManualStoppage?.active;
  const pklManualActive = processCode === 'PKL' && !!processManualStoppage?.active;
  const hrsManualEligible = processCode === 'HRS' && !!processManualStoppage?.eligible && !processManualStoppage?.active;
  const hrsManualActive = processCode === 'HRS' && !!processManualStoppage?.active;
  const showManualStopBtn =
    onManualStoppage
    && ((isCrmMill && (manualStoppageEligible || manualStoppageActive))
      || pklManualEligible
      || pklManualActive
      || hrsManualEligible
      || hrsManualActive);
  const crmRunning = isCrmMill && activeStatus === 'IN_PROGRESS' && !crmStoppageActive;
  const processRunning = isProcess && (captureStatus === 'running' || captureStatus === 'stoppage');
  const showStopped = crmStoppageActive || !!runningStoppage || (isProcess && captureStatus === 'stoppage') || pklManualActive || hrsManualActive;
  const showRunning = isCrmMill ? crmRunning : processRunning;



  const handoverPath = basePath ? `${basePath}/handover` : '/coming-soon/6HI';

  return (
    <header className="shrink-0 border-b border-border bg-background z-30 shadow-sm">
      <div className="flex items-stretch min-h-[52px]">
        <div className="flex items-center gap-3 px-4 border-r border-border min-w-[140px]">
          <span className="font-mono text-lg font-semibold tracking-tight text-primary">{line}</span>
          <span className="text-sm font-medium text-muted-foreground border-l border-border pl-3 py-1">
            {detectedShift?.shiftName ?? `Shift ${shiftCode}`}
          </span>
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

        <div className="flex-1 min-w-0" />

        <div className="flex items-center gap-3 px-4">
          {showStopped ? (
            <ZBadge tone="destructive" label="STOPPED" dot />
          ) : showRunning ? (
            <ZBadge tone="success" label="Running" dot />
          ) : (
            <ZBadge tone="muted" label="Idle" dot />
          )}

          <DeviceStatusIndicators />

          <SyncStatusBadge />
          <RailClock />
          {isCrmMill && onShiftReadings && (
            <button
              type="button"
              onClick={onShiftReadings}
              className="h-10 px-3 rounded-lg border border-border bg-secondary/40 text-foreground text-sm font-bold uppercase tracking-wide hover:bg-secondary transition-colors"
              title="Shift readings"
            >
              Readings
            </button>
          )}
          {showManualStopBtn && (
            <button
              type="button"
              onClick={onManualStoppage}
              className="h-10 px-4 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm font-bold uppercase tracking-wide hover:bg-destructive/20 transition-colors flex items-center gap-2"
            >
              <PauseCircle className="h-4 w-4" aria-hidden />
              {(manualStoppageActive || pklManualActive || hrsManualActive) ? 'Manage Stop' : 'Manual Stop'}
            </button>
          )}
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

      {(crmStoppageActive || runningStoppage || pklManualActive || hrsManualActive || processOrderStoppage) && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <CircleStop className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">
            {crmStoppageActive && panelOrder?.activeStoppage
              ? `${panelOrder.activeStoppage.categoryLabel} — since ${formatPlantClock(panelOrder.activeStoppage.startAt)}`
              : manualStoppageActive
                ? `Manual stoppage — since ${formatPlantClock(manualStoppage!.active!.startedAt)}`
                : pklManualActive
                ? `${processManualStoppage!.active!.categoryLabel ?? 'Manual stoppage'} — since ${formatPlantClock(processManualStoppage!.active!.startedAt)}`
                : hrsManualActive
                ? `${processManualStoppage!.active!.categoryLabel ?? 'Manual stoppage'} — since ${formatPlantClock(processManualStoppage!.active!.startedAt)}`
                : processOrderStoppage
                ? `${stoppageRemarks.trim() || `Code ${stoppageCode}`} — since ${formatPlantClock(stoppageStartedAt!)}`
                : runningStoppage
                ? `${runningStoppage.reason} — since ${runningStoppage.fromTime}`
                : 'Stoppage active'}
          </span>
        </div>
      )}
    </header>
  );
}
