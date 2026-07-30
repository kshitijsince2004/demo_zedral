import { useEffect } from 'react';
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
import { getProcessConfig, isProcessStationCode } from '../../lib/processConfig';
import { useShiftEndWatcher, SHIFT_END_REMINDER_MS } from '../../hooks/useShiftEndWatcher';

export function ProcessLayout() {
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const { basePath, processCode } = useProcessWorkspaceBase();
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
    openDefectPanel,
    openCrewPanel,
  } = useProcessStore();

  const onHandoverRoute = /\/handover\/?$/.test(location.pathname);
  const shiftWatcher = useShiftEndWatcher({ enabled: !onHandoverRoute });
  const handoverPath = basePath ? `${basePath}/handover` : null;

  const machine = activeMachine && isProcessStationCode(activeMachine) ? activeMachine : processCode;
  const config = getProcessConfig(machine);

  useEffect(() => {
    if (machine) setProcessCode(machine);
  }, [machine, setProcessCode]);

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
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden pr-[5.5rem]">
            <Outlet context={{ config, processCode: machine }} />
          </div>
          {activeCoilNo && config.archetype !== 'B' && (
            <ProductionActionRail
              coilNo={activeCoilNo}
              status={captureStatus}
              stoppageStartedAt={stoppageStartedAt ?? undefined}
              runStartedAt={runStartedAt ?? undefined}
              busy={busy}
              onStart={() => startCapture(activeCoilNo)}
              onStop={() => stopCapture()}
              onDefect={() => openDefectPanel()}
              onCrew={() => openCrewPanel()}
              onEndEntry={() => navigate(`${basePath}/capture/${encodeURIComponent(activeCoilNo)}`)}
              onEndShift={() => {
                if (handoverPath) navigate(handoverPath);
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
