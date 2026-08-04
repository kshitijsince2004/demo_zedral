import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { OrderEndModal } from '../sixHi/OrderEndModal';
import { OrderRejectionModal } from '../sixHi/OrderRejectionModal';
import { OrderStoppageModal } from '../sixHi/OrderStoppageModal';
import { OrderRemarkModal } from '../sixHi/OrderRemarkModal';
import { CrewCaptureModal, CREW_CAPTURE_SNOOZE_MS } from '../sixHi/CrewCaptureModal';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { getProcessConfig, isProcessStationCode, type ProcessStationCode } from '../../lib/processConfig';
import { useShiftEndWatcher, SHIFT_END_REMINDER_MS } from '../../hooks/useShiftEndWatcher';
import { rejectRwdOrder } from '../../lib/rewindingWrites';
import {
  endPklManualStoppage,
  fetchPklManualStoppage,
  patchPklManualStoppage,
  startPklManualStoppage,
  type PklManualStoppageStatus,
} from '../../lib/hrsPklWrites';
import { useMachineStoppageCodes, toStoppageCategoryCode } from '../../lib/pklStoppageCodes';
import { machineHandoverService } from '../../services/machineHandoverService';
import { DEFECT_OTHER_CODE } from '../../lib/defectCodes';
import { submitOrQueue } from '../../operator/sync/submitOrQueue';
import type { SixHiOrderStoppage } from '@m1/shared-validation';

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
    runStoppages,
    activeStoppageId,
    busy,
    captureError,
    clearCaptureError,
    endConfirmToken,
    setProcessCode,
    startCapture,
    stopCapture,
    openRemarkPanel,
    closeRemarkPanel,
    remarkPanelOpen,
    requestEndCapture,
    requestManageStoppage,
  } = useProcessStore();

  const onHandoverRoute = /\/handover\/?$/.test(location.pathname);
  const shiftWatcher = useShiftEndWatcher({ enabled: !onHandoverRoute });
  const handoverPath = basePath ? `${basePath}/handover` : null;
  const shiftLogId = useShiftStore((s) => s.shiftLogId);
  const [endOpen, setEndOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [manualStoppageOpen, setManualStoppageOpen] = useState(false);
  const [orderStoppageOpen, setOrderStoppageOpen] = useState(false);
  const [pklManualStoppage, setPklManualStoppage] = useState<PklManualStoppageStatus | null>(null);
  const [crewPrompt, setCrewPrompt] = useState<{ sessionId: string } | null>(null);
  const [crewSnoozeUntil, setCrewSnoozeUntil] = useState(0);
  const [crewPendingSessionId, setCrewPendingSessionId] = useState<string | null>(null);
  const crewSnoozeUntilRef = useRef(crewSnoozeUntil);
  crewSnoozeUntilRef.current = crewSnoozeUntil;
  const queue = useProcessStore((s) => s.queue);
  const holdCoil = useProcessStore((s) => s.holdCoil);

  const machine: ProcessStationCode = isProcessStationCode(stationCode)
    ? stationCode
    : 'HRS';
  const { codes: machineStoppageCodes, loading: machineStoppageCodesLoading } = useMachineStoppageCodes(machine);
  const config = getProcessConfig(machine);
  /** RWD capture owns the rail; never show ProcessLayout rail for RWD (wrong /capture End path). */
  const hideShellRail = machine === 'RWD' || /\/rewinding\//.test(location.pathname);
  const activeCard = activeCoilNo ? queue.find((c) => c.coilNo === activeCoilNo) : undefined;
  const isCompleted = activeCard?.status === 'COMPLETED';
  const isPkl = machine === 'PKL';

  useLayoutEffect(() => {
    // Sync reset on line change — authStore→processStore would cycle via apiClient.
    const prev = useProcessStore.getState().processCode;
    if (prev !== machine) {
      useProcessStore.getState().resetForLine(machine);
    } else {
      setProcessCode(machine);
    }
    if (activeMachine !== machine) setActiveMachine(machine);
    setCrewPendingSessionId(null);
    setCrewPrompt(null);
    setCrewSnoozeUntil(0);
  }, [machine, activeMachine, setActiveMachine, setProcessCode]);

  // Body Save Production Data → same OrderEndModal as rail End.
  useEffect(() => {
    if (endConfirmToken > 0) setEndOpen(true);
  }, [endConfirmToken]);

  // Rolling parity (PKL): after shift-change modal closes, soft-prompt crew again.
  useEffect(() => {
    if (!isPkl) return;
    if (shiftWatcher.status !== 'changed') return;
    if (shiftWatcher.visible) return;
    if (Date.now() < crewSnoozeUntil) return;
    if (crewPrompt) return;
    if (crewPendingSessionId) {
      setCrewPrompt({ sessionId: crewPendingSessionId });
      return;
    }
    void (async () => {
      try {
        const sess = await machineHandoverService.ensureSession(machine);
        const sid = sess?.session
          ? String(sess.session.session_id ?? sess.session.sessionId ?? '')
          : '';
        if (sid) {
          setCrewPendingSessionId(sid);
          setCrewPrompt({ sessionId: sid });
        }
      } catch {
        /* soft — do not block production */
      }
    })();
  }, [isPkl, shiftWatcher.status, shiftWatcher.visible, crewSnoozeUntil, crewPendingSessionId, crewPrompt, machine]);

  useEffect(() => {
    async function init() {
      if (!machine) return;
      try {
        await bootstrapShiftContext(machine);
        // Rolling parity (PKL): soft-mandatory crew when session created / needsCrew.
        if (isPkl) {
          const sess = await machineHandoverService.ensureSession(machine).catch(() => null);
          const sid = sess?.session
            ? String(sess.session.session_id ?? sess.session.sessionId ?? '')
            : '';
          if ((sess?.created || sess?.needsCrew) && sid) {
            setCrewPendingSessionId(sid);
            if (Date.now() >= crewSnoozeUntilRef.current) {
              setCrewPrompt({ sessionId: sid });
            }
          } else if (!sess?.needsCrew) {
            setCrewPrompt(null);
            setCrewPendingSessionId(null);
          }
        }
        const { shiftDate, shiftCode } = useShiftStore.getState();
        const qs = `?date=${encodeURIComponent(shiftDate)}&shift=${encodeURIComponent(shiftCode)}`;
        const data = await apiClient.get<{
          shiftLogId: string;
          shiftDate: string;
          shiftCode: string;
          targetMt?: number;
          producedMt?: number;
        }>(`/shift-logs/active/${machine}${qs}`);
        useShiftStore.setState({
          shiftLogId: data.shiftLogId,
          shiftDate: formatShiftDate(data.shiftDate),
          shiftCode: data.shiftCode as 'A' | 'B' | 'C',
          targetMt: data.targetMt,
          producedMt: data.producedMt,
          processLine: machine,
        });
        // Restore rail after refresh even when landing off Live Status.
        if (machine === 'HRS' || machine === 'PKL') {
          const cards = await useProcessStore.getState().loadQueueFor(machine);
          const running = cards.find((c) => c.status === 'IN_PROGRESS' || c.status === 'STOPPAGE');
          const { captureStatus, runStartedAt, stoppageStartedAt, hydrateProcessRun } =
            useProcessStore.getState();
          if (
            running
            && !(captureStatus === 'running' && runStartedAt)
            && !(captureStatus === 'stoppage' && stoppageStartedAt)
          ) {
            const { fetchHrsPklOrder, orderToHydrateInput } = await import('../../lib/hrsPklWrites');
            const order = await fetchHrsPklOrder(machine, running.coilNo);
            hydrateProcessRun(orderToHydrateInput(order));
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) logout();
      }
    }
    void init();
  }, [machine, logout, isPkl]);

  useEffect(() => {
    if (machine !== 'PKL') {
      setPklManualStoppage(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await fetchPklManualStoppage();
        if (!cancelled) setPklManualStoppage(status);
      } catch {
        if (!cancelled) setPklManualStoppage(null);
      }
    };
    void refresh();
    const id = setInterval(() => { void refresh(); }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [machine]);

  const pklManualActiveStoppage = useMemo((): SixHiOrderStoppage | undefined => {
    const active = pklManualStoppage?.active;
    if (!active) return undefined;
    return {
      id: active.eventId,
      categoryCode: active.categoryCode ?? '',
      categoryLabel: active.categoryLabel ?? 'Manual stoppage',
      breakdownCode: active.breakdownCode,
      startAt: active.startedAt,
      remarks: active.reason,
    };
  }, [pklManualStoppage]);

  return (
    <HandoverAcceptGate machineCode={machine}>
      <OperatorShell
        processCode={machine}
        onManualStoppage={machine === 'PKL' ? () => setManualStoppageOpen(true) : undefined}
        processManualStoppage={machine === 'PKL' ? pklManualStoppage : null}
      >        <div className={[
          'flex flex-1 min-h-0 overflow-hidden',
          activeCoilNo && !hideShellRail && config.archetype !== 'B' ? 'pr-[6.5rem]' : '',
        ].join(' ')}>
          <div className="flex flex-1 flex-col min-h-0 min-w-0 h-full overflow-hidden">
            {captureError && (
              <div className="mx-4 mt-3 shrink-0 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex gap-3 items-start justify-between">
                <div>
                  <p className="font-bold">Cannot start / stoppage</p>
                  <p className="mt-1">{captureError}</p>
                </div>
                <button type="button" className="text-xs font-bold uppercase shrink-0" onClick={clearCaptureError}>
                  Dismiss
                </button>
              </div>
            )}
            <Outlet context={{ config, processCode: machine }} />
          </div>
          {activeCoilNo && !hideShellRail && config.archetype !== 'B' && (
            <ProductionActionRail
              coilNo={activeCoilNo}
              status={captureStatus}
              stoppageStartedAt={stoppageStartedAt ?? undefined}
              runStartedAt={runStartedAt ?? undefined}
              timerMode={isPkl ? 'net' : 'wall'}
              runStoppages={runStoppages}
              activeStoppageId={activeStoppageId}
              busy={busy || isCompleted}
              onStart={() => { if (!isCompleted) startCapture(activeCoilNo); }}
              onEnd={() => {
                if (isCompleted) return;
                const path = `${basePath}/capture/${encodeURIComponent(activeCoilNo)}`;
                if (!location.pathname.includes('/capture/')) {
                  navigate(path);
                }
                setEndOpen(true);
              }}
              onStoppage={() => {
                if (isCompleted) return;
                if (captureStatus === 'running') {
                  if (isPkl) {
                    setOrderStoppageOpen(true);
                    return;
                  }
                  stopCapture();
                } else if (captureStatus === 'stoppage') {
                  requestManageStoppage();
                }
                if (!location.pathname.includes('/capture/') && activeCoilNo) {
                  navigate(`${basePath}/capture/${encodeURIComponent(activeCoilNo)}`);
                }
              }}
              onRemark={() => {
                if (isCompleted || !activeCoilNo) return;
                if (!location.pathname.includes('/capture/')) {
                  navigate(`${basePath}/capture/${encodeURIComponent(activeCoilNo)}`);
                }
                openRemarkPanel();
              }}
              onHold={() => {
                if (isCompleted) return;
                setRejectOpen(true);
              }}
            />
          )}
        </div>

        <OrderEndModal
          open={endOpen && !!activeCoilNo}
          batchNumber={activeCoilNo ?? ''}
          orderLabel={activeCoilNo ? `${machine} · ${activeCoilNo}` : undefined}
          appliesTo={machine}
          onClose={() => setEndOpen(false)}
          onConfirm={async () => {
            requestEndCapture();
          }}
        />

        <OrderRejectionModal
          open={rejectOpen && !!activeCoilNo}
          batchNumber={activeCoilNo ?? ''}
          orderLabel={activeCoilNo ? `${machine} · ${activeCoilNo}` : undefined}
          appliesTo={machine}
          onClose={() => setRejectOpen(false)}
          onReject={async (coilOrBatch, rejectionReason, _defectCodes, remarks) => {
            if (machine === 'HRS') {
              await apiClient.post(`/hrs-order/orders/${encodeURIComponent(coilOrBatch)}/reject`, {
                rejectionReason,
                remarks,
              });
            } else if (machine === 'PKL') {
              await apiClient.post(`/pkl-order/orders/${encodeURIComponent(coilOrBatch)}/reject`, {
                rejectionReason,
                remarks,
              });
            } else if (machine === 'RWD') {
              const batch = activeCard?.batchNumber ?? coilOrBatch;
              await rejectRwdOrder(batch, rejectionReason, remarks);
            } else {
              await holdCoil(coilOrBatch, remarks);
            }
            useProcessStore.getState().finishCapture();
            useProcessStore.getState().requestQueueRefresh();
            await useProcessStore.getState().loadQueue();
            navigate(basePath);
          }}
        />

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
          onRemindLater={() => {
            shiftWatcher.remindLater();
            if (!isPkl) return;
            const sid = crewPendingSessionId;
            if (sid && Date.now() >= crewSnoozeUntil) {
              setCrewPrompt({ sessionId: sid });
            } else if (!sid) {
              void machineHandoverService.ensureSession(machine).then((sess) => {
                const nextSid = sess?.session
                  ? String(sess.session.session_id ?? sess.session.sessionId ?? '')
                  : '';
                if (nextSid) {
                  setCrewPendingSessionId(nextSid);
                  setCrewPrompt({ sessionId: nextSid });
                }
              }).catch(() => undefined);
            }
          }}
          onHandover={() => {
            if (handoverPath) navigate(handoverPath);
          }}
        />

        {isPkl && (
          <CrewCaptureModal
            open={!!crewPrompt && !shiftWatcher.visible && !manualStoppageOpen && !orderStoppageOpen}
            machineCode={machine}
            sessionId={crewPrompt?.sessionId ?? ''}
            onDone={() => {
              setCrewPrompt(null);
              setCrewPendingSessionId(null);
            }}
            onSnooze={() => {
              setCrewSnoozeUntil(Date.now() + CREW_CAPTURE_SNOOZE_MS);
              setCrewPrompt(null);
              window.setTimeout(() => setCrewSnoozeUntil(0), CREW_CAPTURE_SNOOZE_MS);
            }}
          />
        )}

        {remarkPanelOpen && !!activeCoilNo && !isCompleted && (
          <OrderRemarkModal
            open={remarkPanelOpen}
            batchNumber={activeCoilNo}
            orderLabel={`${machine} · ${activeCoilNo}`}
            orderSubtitle={activeCard?.gradeCode}
            appliesTo={machine}
            onClose={closeRemarkPanel}
            onSave={async (text, defects) => {
              if (!shiftLogId) throw new Error('No active shift');
              const codes = defects.length > 0
                ? defects.map((d) => d.defectCode)
                : [`${DEFECT_OTHER_CODE}:${text}`];
              await Promise.all(codes.map((defectCode) => submitOrQueue({
                url: '/defects',
                method: 'POST',
                payload: {
                  shiftLogId,
                  coilNo: activeCoilNo,
                  defectCode,
                  entryId: shiftLogId,
                  remarks: text,
                },
                aggregateKey: `remark:${shiftLogId}:${activeCoilNo}:${defectCode}`,
              })));
              closeRemarkPanel();
            }}
          />
        )}

        {isPkl && (
          <OrderStoppageModal
            open={orderStoppageOpen && captureStatus === 'running'}
            hasActiveStoppage={false}
            title="Record Stoppage"
            subtitle={activeCoilNo ? `PKL · ${activeCoilNo}` : 'Pickling'}
            startButtonLabel="Start Stoppage"
            stoppageCodes={machineStoppageCodes}
            stoppageCodesLoading={machineStoppageCodesLoading}
            onClose={() => setOrderStoppageOpen(false)}
            onStart={async (categoryCode, _breakdownCode, remarks) => {
              stopCapture({
                categoryCode: toStoppageCategoryCode(categoryCode),
                remarks,
              });
              setOrderStoppageOpen(false);
              if (activeCoilNo && !location.pathname.includes('/capture/')) {
                navigate(`${basePath}/capture/${encodeURIComponent(activeCoilNo)}`);
              }
            }}
            onUpdate={async () => undefined}
            onEnd={async () => undefined}
          />
        )}

        {isPkl && (
          <OrderStoppageModal
            open={manualStoppageOpen}
            hasActiveStoppage={!!pklManualActiveStoppage}
            activeStoppage={pklManualActiveStoppage}
            title={pklManualActiveStoppage ? 'Manage Manual Stoppage' : 'Manual Stoppage'}
            subtitle="Record pickling line downtime when no coil is in production."
            startButtonLabel="Start Stoppage"
            stoppageCodes={machineStoppageCodes}
            stoppageCodesLoading={machineStoppageCodesLoading}
            onClose={() => setManualStoppageOpen(false)}
            onStart={async (categoryCode, breakdownCode, remarks) => {
              const status = await startPklManualStoppage({
                categoryCode: toStoppageCategoryCode(categoryCode),
                breakdownCode,
                remarks,
              });
              setPklManualStoppage(status);
            }}
            onUpdate={async (_stoppageId, categoryCode, breakdownCode, remarks) => {
              const status = await patchPklManualStoppage({
                categoryCode: toStoppageCategoryCode(categoryCode),
                breakdownCode,
                remarks,
              });
              setPklManualStoppage(status);
            }}
            onEnd={async (_stoppageId, categoryCode, breakdownCode, remarks) => {
              await patchPklManualStoppage({
                categoryCode: toStoppageCategoryCode(categoryCode),
                breakdownCode,
                remarks,
              });
              const status = await endPklManualStoppage();
              setPklManualStoppage(status);
            }}
          />
        )}
      </OperatorShell>
    </HandoverAcceptGate>
  );
}
