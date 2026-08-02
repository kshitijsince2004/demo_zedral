import { useEffect, useLayoutEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { bootstrapShiftContext } from '../../lib/shiftDetection';
import { formatShiftDate } from '../../lib/dateFormat';
import { OperatorShell } from '../layout/operator/OperatorShell';
import { HandoverAcceptGate } from '../HandoverAcceptGate';
import { useShiftStore } from '../../store/shiftStore';
import { useProcessStore } from '../../store/processStore';
import { apiClient, ApiError } from '../../lib/apiClient';
import { ProductionActionRail } from './ProductionActionRail';
import { ShiftEndModal } from '../sixHi/ShiftEndModal';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { getProcessConfig, isProcessStationCode, type ProcessStationCode } from '../../lib/processConfig';
import { useShiftEndWatcher, SHIFT_END_REMINDER_MS } from '../../hooks/useShiftEndWatcher';

interface ProcessLayoutProps {
  /** Resolved station from UserScopeShell (not stale activeMachine). */
  stationCode: string;
}

export function ProcessLayout({ stationCode }: ProcessLayoutProps) {
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const setActiveMachine = useAuthStore((s) => s.setActiveMachine);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const { basePath } = useProcessWorkspaceBase();
  const navigate = useNavigate();
  const {
    activeCoilNo,
    captureStatus,
    stoppageStartedAt,
    runStartedAt,
    busy,
    setProcessCode,
    startCapture,
    stopCapture,
    openRemarkPanel,
    holdCoil,
    requestEndCapture,
  } = useProcessStore();

  const onHandoverRoute = /\/handover\/?$/.test(location.pathname);
  const shiftWatcher = useShiftEndWatcher({ enabled: !onHandoverRoute });
  const handoverPath = basePath ? `${basePath}/handover` : null;

  const machine: ProcessStationCode = isProcessStationCode(stationCode)
    ? stationCode
    : 'HRS';
  const config = getProcessConfig(machine);
  /** RWD capture owns the rail; never show ProcessLayout rail for RWD (wrong /capture End path). */
  const hideShellRail = machine === 'RWD' || /\/rewinding\//.test(location.pathname);

  useLayoutEffect(() => {
    setProcessCode(machine);
    if (activeMachine !== machine) setActiveMachine(machine);
  }, [machine, activeMachine, setActiveMachine, setProcessCode]);

  useEffect(() => {
    async function init() {
      if (!machine) return;
      try {
        await bootstrapShiftContext(machine);
        const { shiftDate, shiftCode } = useShiftStore.getState();
        const qs = `?date=${encodeURIComponent(shiftDate)}&shift=${encodeURIComponent(shiftCode)}`;
        const data = await apiClient.get(`/shift-logs/active/${machine}${qs}`);
        useShiftStore.setState({
          shiftLogId: data.shiftLogId,
          shiftDate: formatShiftDate(data.shiftDate),
          shiftCode: data.shiftCode as 'A' | 'B' | 'C',
          targetMt: data.targetMt,
          producedMt: data.producedMt,
          processLine: machine,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) logout();
      }
    }
    void init();
  }, [machine, logout]);

  return (
    <HandoverAcceptGate machineCode={machine}>
      <OperatorShell processCode={machine}>
        <div className={[
          'flex flex-1 min-h-0 overflow-hidden',
          activeCoilNo && !hideShellRail && config.archetype !== 'B' ? 'pr-[6.5rem]' : '',
        ].join(' ')}>
          <div className="flex flex-1 flex-col min-h-0 min-w-0 h-full overflow-hidden">
            <Outlet context={{ config, processCode: machine }} />
          </div>
          {activeCoilNo && !hideShellRail && config.archetype !== 'B' && (
            <ProductionActionRail
              coilNo={activeCoilNo}
              status={captureStatus}
              stoppageStartedAt={stoppageStartedAt ?? undefined}
              runStartedAt={runStartedAt ?? undefined}
              busy={busy}
              onStart={() => startCapture(activeCoilNo)}
              onEnd={() => {
                const path = `${basePath}/capture/${encodeURIComponent(activeCoilNo)}`;
                if (!location.pathname.includes('/capture/')) {
                  navigate(path);
                }
                // CaptureWorkspace submits #process-capture-form (real /production/:line complete).
                requestEndCapture();
              }}
              onStoppage={() => {
                if (captureStatus === 'running') stopCapture();
                if (!location.pathname.includes('/capture/')) {
                  navigate(`${basePath}/capture/${encodeURIComponent(activeCoilNo)}`);
                }
              }}
              onRemark={() => openRemarkPanel()}
              onHold={() => {
                void holdCoil(activeCoilNo).then(() => navigate(basePath));
              }}
            />
          )}
        </div>

        <ShiftEndModal
          open={shiftWatcher.visible}
          status={shiftWatcher.status}
          shiftCode={shiftWatcher.sessionShiftCode}
          shiftName={shiftWatcher.sessionShiftName}
          windowStart={shiftWatcher.windowStart}
          windowEnd={shiftWatcher.windowEnd}
          prodDate={shiftWatcher.prodDate}
          newShiftCode={shiftWatcher.newShiftCode}
          newShiftName={shiftWatcher.newShiftName}
          reminderMinutes={Math.round(SHIFT_END_REMINDER_MS / 60_000)}
          onRemindLater={shiftWatcher.remindLater}
          onHandover={() => {
            if (handoverPath) navigate(handoverPath);
          }}
        />
      </OperatorShell>
    </HandoverAcceptGate>
  );
}
