import { useEffect, useRef, useState } from 'react';
import type { SixHiOrderStoppage } from '@m1/shared-validation';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useShiftEndWatcher, SHIFT_END_REMINDER_MS } from '../../hooks/useShiftEndWatcher';
import { CRM_SHIFT_PROCESS_CODE } from '../../lib/millConfig';
import { OperatorShell } from '../layout/operator/OperatorShell';
import { useShiftStore } from '../../store/shiftStore';
import { useSixHiStore, shouldShowProductionPanel } from '../../store/sixHiStore';
import { apiClient, ApiError } from '../../lib/apiClient';
import {
  addOrderRemark,
  endManualStoppage,
  endOrderImmediate,
  endStoppage,
  patchManualStoppage,
  rejectOrder,
  rollChange,
  startCombinedOrdersImmediate,
  startManualStoppage,
  startOrderImmediate,
  startStoppage,
  updateStoppage,
} from '../../lib/sync/sixHiWrites';
import { subscribeProductionChanged } from '../../lib/productionSync';
import { invalidateAfterWrite } from '../../lib/sync/invalidateAfterWrite';
import { useAuthStore } from '../../lib/authStore';
import { canWriteMachine } from '../../lib/machineRouting';
import { bootstrapShiftContext } from '../../lib/shiftDetection';
import { formatShiftDate } from '../../lib/dateFormat';
import { HandoverAcceptGate } from '../HandoverAcceptGate';
import { machineHandoverService } from '../../services/machineHandoverService';
import { SixHiWorkspaceModal } from './SixHiWorkspaceModal';
import { SixHiGlobalProductionPanel } from './SixHiGlobalProductionPanel';
import { OrderStoppageModal } from './OrderStoppageModal';
import type { ManualStoppageState } from '../../store/sixHiStore';
import { OrderRejectionModal } from './OrderRejectionModal';
import { OrderEndModal } from './OrderEndModal';
import { SixHiManualOrderModal } from './SixHiManualOrderModal';
import { RewindingManualOrderModal } from '../rewinding/RewindingManualOrderModal';
import { ZButton } from '../primitives/ZButton';
import { OrderRemarkModal } from './OrderRemarkModal';
import { ShiftEndModal } from './ShiftEndModal';
import { CrewCaptureModal, CREW_CAPTURE_SNOOZE_MS } from './CrewCaptureModal';
import { ShiftReadingsModal } from './ShiftReadingsModal';
import { orderIdentitySubtitle, displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { buildCombinedRunFromSelected } from '../../lib/combinedProductionRun';
import { resolveCombinedActualMt } from '../../lib/combinedWeightAllocation';
import type { SixHiOrderDetail } from '@m1/shared-validation';

function manualStoppageAsOrderStoppage(active: ManualStoppageState['active']): SixHiOrderStoppage | undefined {
  if (!active) return undefined;
  return {
    id: active.eventId,
    categoryCode: active.categoryCode ?? '',
    categoryLabel: active.categoryLabel ?? active.categoryCode ?? '',
    breakdownCode: active.breakdownCode,
    startAt: active.startedAt,
    remarks: active.reason,
  };
}

export function SixHiLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { basePath, machineCode: pathMill } = useWorkspaceBase();
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const logout = useAuthStore((s) => s.logout);
  const role = useAuthStore((s) => s.role);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const { shiftLogId } = useShiftStore();

  const {
    workspaceOpen,
    workspaceBatch,
    panelOrder,
    combinedRun,
    combinedSelectedBatches,
    busy,
    openWorkspace,
    closeWorkspace,
    runOrderAction,
    refreshMachineState,
    loadShiftSummary,
    machineActive,
    setMachineCode,
    stoppageModalBatch,
    closeStoppageDialog,
    openStoppageDialog,
    manualStoppage,
    setCombinedRun,
    manualOrderOpen,
    closeManualOrder,
    requestQueueRefresh,
  } = useSixHiStore();

  const [rejectionOpen, setRejectionOpen] = useState(false);
  const [rejectionBatch, setRejectionBatch] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [manualStoppageOpen, setManualStoppageOpen] = useState(false);
  const [startError, setStartError] = useState<{ message: string; activeBatch?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [crewPrompt, setCrewPrompt] = useState<{ sessionId: string } | null>(null);
  const [crewSnoozeUntil, setCrewSnoozeUntil] = useState(0);
  // Keep session id so snooze can re-prompt until crew is saved (needsCrew on resume).
  const [crewPendingSessionId, setCrewPendingSessionId] = useState<string | null>(null);
  const crewSnoozeUntilRef = useRef(crewSnoozeUntil);
  crewSnoozeUntilRef.current = crewSnoozeUntil;
  const [sessionRecovering, setSessionRecovering] = useState(false);
  const [readingsOpen, setReadingsOpen] = useState(false);

  // Suppress the automatic shift-end prompt while the operator is already on the
  // handover / summary pages (they are actively completing the handover there).
  const onHandoverRoute = /\/handover\/?$/.test(location.pathname);
  const shiftWatcher = useShiftEndWatcher({ enabled: !onHandoverRoute });
  const handoverPath = basePath ? `${basePath}/handover` : null;

  // SPEC2 §11: clock rolled to a new shift while still logged in — re-prompt crew after
  // the shift-end modal is dismissed so overtime does not silently keep the prior crew.
  useEffect(() => {
    if (shiftWatcher.status !== 'changed') return;
    if (shiftWatcher.visible) return;
    if (Date.now() < crewSnoozeUntil) return;
    if (crewPrompt) return;
    if (crewPendingSessionId) {
      setCrewPrompt({ sessionId: crewPendingSessionId });
      return;
    }
    void recoverSession({ forceCrew: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftWatcher.status, shiftWatcher.visible, crewSnoozeUntil, crewPendingSessionId]);

  const recoverSession = async (opts?: { forceCrew?: boolean }) => {
    if (sessionRecovering) return;
    if (!canWriteMachine(role, machineAccess, pathMill)) return;
    setSessionRecovering(true);
    try {
      const sess = await machineHandoverService.ensureSession(pathMill);
      const sid = sess?.session
        ? String(sess.session.session_id ?? sess.session.sessionId ?? '')
        : '';
      // SPEC2 §11: prompt on fresh create OR resume when needsCrew (empty session_crew).
      if ((sess?.created || sess?.needsCrew || opts?.forceCrew) && sid) {
        setCrewPendingSessionId(sid);
        if (Date.now() >= crewSnoozeUntil) setCrewPrompt({ sessionId: sid });
      }
      await bootstrapShiftContext(pathMill);
      await refreshMachineState();
      setActionError(null);
      setStartError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to recover session';
      setActionError(message);
    } finally {
      setSessionRecovering(false);
    }
  };

  const maybeRecoverFromSessionError = async (message: string) => {
    if (/NO_ACTIVE_SESSION|ACTIVE_SESSION_CONFLICT/i.test(message)) {
      await recoverSession({ forceCrew: /NO_ACTIVE_SESSION/i.test(message) });
      return true;
    }
    return false;
  };

  useEffect(() => {
    setMachineCode(pathMill);
    setCrewPendingSessionId(null);
    setCrewPrompt(null);
    setCrewSnoozeUntil(0);
  }, [pathMill, setMachineCode]);

  useEffect(() => {
    async function init() {
      try {
        if (!canWriteMachine(role, machineAccess, pathMill)) {
          await refreshMachineState();
          return;
        }
        // Ensure session first so /shifts/current?machine= pins to ACTIVE (not clock).
        const sess = await machineHandoverService.ensureSession(pathMill).catch(() => null);
        const sid = sess?.session
          ? String(sess.session.session_id ?? sess.session.sessionId ?? '')
          : '';
        // SPEC2 §11 soft-mandatory: needsCrew on resume/re-login, not only created.
        if ((sess?.created || sess?.needsCrew) && sid) {
          setCrewPendingSessionId(sid);
          if (Date.now() >= crewSnoozeUntilRef.current) {
            setCrewPrompt({ sessionId: sid });
          }
        } else if (!sess?.needsCrew) {
          setCrewPrompt(null);
          setCrewPendingSessionId(null);
        }
        await bootstrapShiftContext(pathMill);
        const { shiftDate, shiftCode } = useShiftStore.getState();
        const qs = `?date=${encodeURIComponent(shiftDate)}&shift=${encodeURIComponent(shiftCode)}`;
        const data = await apiClient.get(`/shift-logs/active/${CRM_SHIFT_PROCESS_CODE}${qs}`);
        useShiftStore.setState({
          shiftLogId: data.shiftLogId,
          shiftDate: formatShiftDate(data.shiftDate),
          shiftCode: data.shiftCode as 'A' | 'B' | 'C',
          targetMt: data.targetMt,
          producedMt: data.producedMt,
          processLine: CRM_SHIFT_PROCESS_CODE,
        });
        if (data.shiftLogId) await loadShiftSummary(data.shiftLogId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) logout();
      }
      await refreshMachineState();
    }
    init();
  }, [pathMill, activeMachine, role, machineAccess, loadShiftSummary, refreshMachineState, logout]);

  // Tablet left open past grace: re-ensure session when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void recoverSession();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recover on visibility only
  }, [pathMill]);

  useEffect(() => {
    return subscribeProductionChanged(() => {
      void refreshMachineState();
    });
  }, [refreshMachineState]);

  useEffect(() => {
    const openBatch = searchParams.get('open');
    if (openBatch) {
      openWorkspace(openBatch);
      searchParams.delete('open');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, openWorkspace]);

  useEffect(() => {
    useSixHiStore.setState({
      requestRejectionDialog: (batchNo: string) => {
        setRejectionBatch(batchNo);
        setRejectionOpen(true);
      },
    });
    return () => useSixHiStore.setState({
      requestRejectionDialog: undefined,
    });
  }, []);

  const pickedBatches = combinedRun
    ? combinedSelectedBatches.filter((b) => combinedRun.batchNumbers.includes(b))
    : [];
  const pickedPrimary = pickedBatches.length > 0
    ? (pickedBatches.includes(combinedRun?.primaryBatchNumber ?? '')
      ? combinedRun!.primaryBatchNumber
      : pickedBatches[0])
    : null;
  const activeBatch = pickedPrimary
    ?? combinedRun?.primaryBatchNumber
    ?? workspaceBatch
    ?? panelOrder?.batchNumber
    ?? machineActive?.batchNumber;
  const rejectTarget = rejectionBatch ?? activeBatch;
  const stoppageBatch = stoppageModalBatch ?? activeBatch;
  // Every action uses the picked list (after start, pick = started subset).
  const actionBatchNumbers = combinedRun
    ? pickedBatches
    : activeBatch
      ? [activeBatch]
      : [];
  const rejectActionBatchNumbers = combinedRun && !rejectionBatch
    ? pickedBatches
    : rejectTarget
      ? [rejectTarget]
      : [];
  const actionOrderCount = actionBatchNumbers.length;
  const modalOrderLabel = combinedRun && !rejectionBatch && actionOrderCount > 1
    ? `Combined run (${actionOrderCount} orders)`
    : panelOrder && (!rejectionBatch || rejectionBatch === panelOrder.batchNumber)
      ? displayMotherCoilId(panelOrder)
      : rejectTarget
        ? `Batch ${rejectTarget}`
        : undefined;
  const modalOrderSubtitle = combinedRun && !rejectionBatch && actionOrderCount > 1
    ? actionBatchNumbers.join(', ')
    : panelOrder && (!rejectionBatch || rejectionBatch === panelOrder.batchNumber)
      ? orderIdentitySubtitle(panelOrder)
      : undefined;
  const showPanel = panelOrder && shouldShowProductionPanel(panelOrder, workspaceOpen, workspaceBatch);
  const canStartCombined = !combinedRun || pickedBatches.length > 0;

  const handleStart = async () => {
    if (!activeBatch) return;
    if (combinedRun && pickedBatches.length === 0) return;
    setStartError(null);
    try {
      const startPrimary = pickedPrimary ?? activeBatch;
      const startBatch = pickedBatches[0] ?? startPrimary;
      await runOrderAction(startPrimary, async () => {
        if (pickedBatches.length >= 2) {
          const { orders } = await startCombinedOrdersImmediate(pickedBatches);
          return orders.find((o) => o.batchNumber === startBatch) ?? orders[0];
        }
        return startOrderImmediate(startBatch);
      });
      // After start: matching list becomes the started subset (leftovers stay in queue).
      if (combinedRun && pickedBatches.length >= 2) {
        const started = buildCombinedRunFromSelected(combinedRun, pickedBatches);
        setCombinedRun(started, { selectedBatches: pickedBatches });
      } else {
        setCombinedRun(null);
      }
      if (shiftLogId) await loadShiftSummary(shiftLogId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { activeBatchNumber?: string } | undefined;
        const activeBatchNumber = body?.activeBatchNumber;
        setStartError({
          message: `Order ${activeBatchNumber ?? 'unknown'} is already active on this machine. End or reject it before starting another.`,
          activeBatch: activeBatchNumber,
        });
      } else {
        const message = err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to start production';
        const recovered = await maybeRecoverFromSessionError(message);
        if (!recovered) setStartError({ message });
        else setStartError({ message: `${message} — session refreshed. Retry the action.` });
      }
    }
  };

  const activeStoppage = panelOrder?.activeStoppage;
  const manualActiveStoppage = manualStoppageAsOrderStoppage(manualStoppage?.active ?? null);

  const handleEnd = () => {
    if (!activeBatch) return;
    setEndOpen(true);
  };

  const handleStoppage = () => {
    if (!activeBatch) return;
    setActionError(null);
    void openStoppageDialog(activeBatch).catch((err) => {
      setActionError(err instanceof Error ? err.message : 'Stoppage unavailable');
    });
  };

  const actionRailProps = panelOrder
    ? {
        order: panelOrder,
        workspaceOpen,
        workspaceBatch,
        busy,
        combinedRun,
        combinedSelectedCount: actionOrderCount,
        matchingCount: combinedRun?.batchNumbers.length ?? 0,
        startDisabled: !canStartCombined,
        onStart: handleStart,
        onEnd: handleEnd,
        onReject: () => {
          setRejectionBatch(panelOrder.batchNumber);
          setRejectionOpen(true);
        },
        onRemark: () => setRemarkOpen(true),
        onStoppage: handleStoppage,
        onViewOrder: () => openWorkspace(panelOrder.batchNumber),
        onCloseWorkspace: workspaceOpen ? closeWorkspace : undefined,
      }
    : null;

  return (
    <OperatorShell
      processCode={pathMill}
      onManualStoppage={() => setManualStoppageOpen(true)}
      onShiftReadings={() => setReadingsOpen(true)}
    >
      <HandoverAcceptGate
        machineCode={pathMill}
        onHandoverAccepted={(sessionId) => {
          setCrewPendingSessionId(sessionId);
          setCrewPrompt({ sessionId });
        }}
      >
        <div className={[
          'flex flex-1 flex-col min-h-0',
          showPanel && !workspaceOpen ? 'pr-[6.5rem]' : '',
        ].join(' ')}>
          <Outlet />
        </div>

      <SixHiWorkspaceModal
        actionRail={
          showPanel && actionRailProps && workspaceOpen ? (
            <SixHiGlobalProductionPanel {...actionRailProps} embedded />
          ) : undefined
        }
      />

      {activeBatch && (
        <OrderEndModal
          open={endOpen}
          batchNumber={activeBatch}
          orderLabel={combinedRun && actionOrderCount > 1
            ? `Combined run (${actionOrderCount} orders)`
            : panelOrder
              ? displayMotherCoilId(panelOrder)
              : `Batch ${activeBatch}`}
          orderSubtitle={combinedRun && actionOrderCount > 1
            ? actionBatchNumbers.join(', ')
            : panelOrder
              ? orderIdentitySubtitle(panelOrder)
              : undefined}
          order={panelOrder ?? undefined}
          appliesTo={pathMill}
          onClose={() => setEndOpen(false)}
          onConfirm={async (defectCodes) => {
            try {
              let combinedActualMt: number | undefined;
              if (actionOrderCount > 1 && combinedRun) {
                const intent = useSixHiStore.getState().combinedActualMtIntent;
                const orders = await Promise.all(
                  combinedRun.batchNumbers.map((batchNo) =>
                    apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNo)}`),
                  ),
                );
                const fromDb = resolveCombinedActualMt(
                  orders.map((o) => o.rolling?.actualWeightMt ?? o.skinPass?.actualWeightMt),
                );
                // Form intent always wins — DB may only have partial/legacy per-order weights.
                combinedActualMt = intent ?? fromDb;
              }
              await runOrderAction(
                activeBatch,
                async () => endOrderImmediate(activeBatch, defectCodes, combinedActualMt),
                { optimisticEndBatchNumbers: actionBatchNumbers },
              );
              if (shiftLogId) await loadShiftSummary(shiftLogId);
              setCombinedRun(null);
              closeWorkspace();
            } catch (err) {
              if (err instanceof ApiError && err.status === 400) {
                setStartError({ message: err.message });
              } else {
                throw err;
              }
            }
          }}
        />
      )}

      <OrderRejectionModal
        open={rejectionOpen}
        batchNumber={rejectTarget ?? ''}
        orderLabel={modalOrderLabel}
        orderSubtitle={modalOrderSubtitle}
        appliesTo={pathMill}
        onClose={() => {
          setRejectionOpen(false);
          setRejectionBatch(null);
        }}
        onReject={async (batchNo, rejectionReason, defectCodes, remarks) => {
          const target = rejectActionBatchNumbers[0] ?? batchNo;
          if (!target) {
            setActionError('No order selected for hold');
            throw new Error('No order selected for hold');
          }
          // Server cascades hold across combined_group_id — post once for the triggered batch.
          await runOrderAction(target, async () =>
            rejectOrder(target, { rejectionReason, defectCodes, remarks }),
          );
          if (shiftLogId) await loadShiftSummary(shiftLogId);
          setCombinedRun(null);
          setRejectionBatch(null);
          closeWorkspace();
        }}
      />
      
      {showPanel && actionRailProps && !workspaceOpen && (
        <SixHiGlobalProductionPanel {...actionRailProps} />
      )}

      {startError && (
        <div className="fixed top-20 left-20 right-24 z-[105] max-w-lg mx-auto bg-destructive/10 border border-destructive text-destructive rounded-xl px-4 py-3 text-sm font-medium space-y-2">
          <p>{startError.message}</p>
          <div className="flex gap-2 flex-wrap">
            {startError.activeBatch && (
              <ZButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  openWorkspace(startError.activeBatch!);
                  setStartError(null);
                }}
              >
                Open {startError.activeBatch}
              </ZButton>
            )}
            <button
              type="button"
              className="underline text-xs"
              disabled={sessionRecovering}
              onClick={() => void recoverSession({ forceCrew: true })}
            >
              {sessionRecovering ? 'Recovering…' : 'Recover session'}
            </button>
            <button type="button" className="underline text-xs" onClick={() => setStartError(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="fixed top-20 left-20 right-24 z-[105] max-w-lg mx-auto bg-destructive/10 border border-destructive text-destructive rounded-xl px-4 py-3 text-sm font-medium">
          <p>{actionError}</p>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className="underline text-xs"
              disabled={sessionRecovering}
              onClick={() => void recoverSession({ forceCrew: true })}
            >
              {sessionRecovering ? 'Recovering…' : 'Recover session'}
            </button>
            <button type="button" className="underline text-xs" onClick={() => setActionError(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {stoppageBatch && (
        <OrderStoppageModal
          open={!!stoppageModalBatch}
          hasActiveStoppage={!!activeStoppage}
          activeStoppage={activeStoppage}
          initialRollInNo={panelOrder?.rolling?.rollInNo}
          initialRollInCode={panelOrder?.rolling?.rollInCode}
          initialRollOutNo={panelOrder?.rolling?.rollOutNo}
          initialRollOutCode={panelOrder?.rolling?.rollOutCode}
          onClose={closeStoppageDialog}
          onStart={async (categoryCode, breakdownCode, remarks) => {
            // Server cascades stoppage across combined_group_id — post once.
            const target = stoppageBatch;
            await runOrderAction(target, async () =>
              startStoppage(target, { categoryCode, breakdownCode, remarks }),
            );
            if (shiftLogId) await loadShiftSummary(shiftLogId);
          }}
          onUpdate={async (stoppageId, categoryCode, breakdownCode, remarks) => {
            const target = stoppageBatch;
            await runOrderAction(target, async () =>
              updateStoppage(target, stoppageId, {
                categoryCode, breakdownCode, remarks,
              }),
            );
            if (shiftLogId) await loadShiftSummary(shiftLogId);
          }}
          onEnd={async (stoppageId, categoryCode, breakdownCode, remarks) => {
            const target = stoppageBatch;
            await runOrderAction(target, async () => {
              await updateStoppage(target, stoppageId, {
                categoryCode, breakdownCode, remarks,
              });
              return endStoppage(target, stoppageId);
            });
            if (shiftLogId) await loadShiftSummary(shiftLogId);
          }}
          onRollChange={async (data) => {
            // Server cascades roll changes across the combined group.
            await runOrderAction(stoppageBatch, () =>
              rollChange(stoppageBatch, data),
            );
          }}
        />
      )}

      <OrderStoppageModal
        open={manualStoppageOpen}
        hasActiveStoppage={!!manualActiveStoppage}
        activeStoppage={manualActiveStoppage}
        initialRollInNo={manualStoppage?.active?.rollInNo}
        initialRollInCode={manualStoppage?.active?.rollInCode}
        initialRollOutNo={manualStoppage?.active?.rollOutNo}
        initialRollOutCode={manualStoppage?.active?.rollOutCode}
        title={manualActiveStoppage ? 'Manage Manual Stoppage' : 'Manual Stoppage'}
        subtitle="Record machine downtime when no production order is active."
        startButtonLabel="Start Stoppage"
        rollChangeTiming="before"
        onClose={() => setManualStoppageOpen(false)}
        onStart={async (categoryCode, breakdownCode, remarks) => {
          await startManualStoppage(pathMill, { categoryCode, breakdownCode, remarks });
          await refreshMachineState();
          invalidateAfterWrite();
        }}
        onUpdate={async (_stoppageId, categoryCode, breakdownCode, remarks) => {
          await patchManualStoppage(pathMill, { categoryCode, breakdownCode, remarks });
          await refreshMachineState();
          invalidateAfterWrite();
        }}
        onEnd={async (_stoppageId, categoryCode, breakdownCode, remarks) => {
          await patchManualStoppage(pathMill, { categoryCode, breakdownCode, remarks });
          await endManualStoppage(pathMill);
          await refreshMachineState();
          invalidateAfterWrite();
        }}
        onRollChange={async (data) => {
          const active = useSixHiStore.getState().manualStoppage?.active;
          if (!active) return;
          await patchManualStoppage(pathMill, {
            categoryCode: active.categoryCode ?? '',
            breakdownCode: active.breakdownCode,
            remarks: active.reason,
            rollChange: data,
          });
          await refreshMachineState();
          invalidateAfterWrite();
        }}
      />

      {searchParams.get('tab') === 'rewinding' ? (
        <RewindingManualOrderModal
          open={manualOrderOpen}
          defaultMachine="2HI"
          onClose={closeManualOrder}
          onCreated={() => requestQueueRefresh()}
        />
      ) : (
        <SixHiManualOrderModal />
      )}

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
        shiftLogId={shiftLogId}
        onRemindLater={() => {
          shiftWatcher.remindLater();
          // SPEC2 §11 secondary: after overtime shift-change snooze, re-prompt crew.
          const sid = crewPendingSessionId;
          if (sid && Date.now() >= crewSnoozeUntil) {
            setCrewPrompt({ sessionId: sid });
          } else if (!sid) {
            void recoverSession({ forceCrew: true });
          }
        }}
        onHandover={() => {
          if (handoverPath) navigate(handoverPath);
        }}
      />

      <ShiftReadingsModal
        open={readingsOpen}
        shiftLogId={shiftLogId}
        onClose={() => setReadingsOpen(false)}
      />

      <CrewCaptureModal
        open={!!crewPrompt && !shiftWatcher.visible && !readingsOpen}
        machineCode={pathMill}
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

      {remarkOpen && activeBatch && (
        <OrderRemarkModal
          open={remarkOpen}
          batchNumber={activeBatch}
          orderLabel={modalOrderLabel}
          orderSubtitle={modalOrderSubtitle}
          busy={busy}
          appliesTo={pathMill}
          onClose={() => setRemarkOpen(false)}
          onSave={async (text, defects) => {
            // Server cascades remarks across combined_group_id — post once.
            await runOrderAction(activeBatch, async () =>
              addOrderRemark(activeBatch, text, defects),
            );
            setRemarkOpen(false);
          }}
        />
      )}
      </HandoverAcceptGate>
    </OperatorShell>
  );
}
