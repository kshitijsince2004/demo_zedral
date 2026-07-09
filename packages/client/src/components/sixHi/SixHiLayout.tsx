import { useEffect, useState } from 'react';
import type { SixHiOrderDetail, SixHiOrderStoppage } from '@m1/shared-validation';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useShiftEndWatcher, SHIFT_END_REMINDER_MS } from '../../hooks/useShiftEndWatcher';
import { CRM_SHIFT_PROCESS_CODE } from '../../lib/millConfig';
import { OperatorShell } from '../layout/operator/OperatorShell';
import { useShiftStore } from '../../store/shiftStore';
import { useSixHiStore, shouldShowProductionPanel } from '../../store/sixHiStore';
import { apiClient, ApiError } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
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
import { ZButton } from '../primitives/ZButton';
import { OrderRemarkModal } from './OrderRemarkModal';
import { ShiftEndModal } from './ShiftEndModal';
import { orderIdentitySubtitle, primaryOrderId } from '../../lib/sixHiOrderIdentity';
import { resolveCombinedStoppageTargets } from '../../lib/combinedProductionRun';

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
  const { shiftLogId } = useShiftStore();

  const {
    workspaceOpen,
    workspaceBatch,
    panelOrder,
    combinedRun,
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
  } = useSixHiStore();

  const [rejectionOpen, setRejectionOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [manualStoppageOpen, setManualStoppageOpen] = useState(false);
  const [startError, setStartError] = useState<{ message: string; activeBatch?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Suppress the automatic shift-end prompt while the operator is already on the
  // handover / summary pages (they are actively completing the handover there).
  const onHandoverRoute = /\/(handover|shift-summary)\/?$/.test(location.pathname);
  const shiftWatcher = useShiftEndWatcher({ enabled: !onHandoverRoute });
  const handoverPath = basePath ? `${basePath}/handover` : null;

  useEffect(() => {
    setMachineCode(pathMill);
  }, [pathMill, setMachineCode]);

  useEffect(() => {
    async function init() {
      try {
        await bootstrapShiftContext(pathMill);
        const { shiftDate, shiftCode } = useShiftStore.getState();
        const qs = `?date=${encodeURIComponent(shiftDate)}&shift=${encodeURIComponent(shiftCode)}`;
        await machineHandoverService.ensureSession(pathMill).catch(() => undefined);
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
  }, [pathMill, activeMachine, loadShiftSummary, refreshMachineState, logout]);

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
      requestRejectionDialog: () => {
        setRejectionOpen(true);
      },
    });
    return () => useSixHiStore.setState({
      requestRejectionDialog: undefined,
    });
  }, []);

  const activeBatch = combinedRun?.primaryBatchNumber ?? workspaceBatch ?? panelOrder?.batchNumber ?? machineActive?.batchNumber;
  const stoppageBatch = stoppageModalBatch ?? activeBatch;
  const actionBatchNumbers = combinedRun?.batchNumbers.length ? combinedRun.batchNumbers : activeBatch ? [activeBatch] : [];
  const modalOrderLabel = combinedRun
    ? `Combined run (${combinedRun.batchNumbers.length} orders)`
    : panelOrder
      ? primaryOrderId(panelOrder)
      : activeBatch
        ? `Batch ${activeBatch}`
        : undefined;
  const modalOrderSubtitle = combinedRun
    ? combinedRun.batchNumbers.join(', ')
    : panelOrder
      ? orderIdentitySubtitle(panelOrder)
      : undefined;
  const showPanel = panelOrder && shouldShowProductionPanel(panelOrder, workspaceOpen, workspaceBatch);

  const handleStart = async () => {
    if (!activeBatch) return;
    setStartError(null);
    try {
      await runOrderAction(activeBatch, async () =>
        combinedRun?.batchNumbers.length
          ? apiClient.post('/6hi/orders/start-combined', { batchNumbers: combinedRun.batchNumbers })
          : apiClient.post(`/6hi/orders/${encodeURIComponent(activeBatch)}/start`, {}),
      );
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
        setStartError({ message });
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
        onStart: handleStart,
        onEnd: handleEnd,
        onReject: () => setRejectionOpen(true),
        onRemark: () => setRemarkOpen(true),
        onStoppage: handleStoppage,
        onViewOrder: () => openWorkspace(panelOrder.batchNumber),
        onCloseWorkspace: workspaceOpen ? closeWorkspace : undefined,
      }
    : null;

  return (
    <HandoverAcceptGate machineCode={pathMill}>
      <OperatorShell processCode={pathMill} onManualStoppage={() => setManualStoppageOpen(true)}>
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
          orderLabel={modalOrderLabel}
          orderSubtitle={modalOrderSubtitle}
          order={panelOrder ?? undefined}
          onClose={() => setEndOpen(false)}
          onConfirm={async (defectCodes) => {
            try {
              await runOrderAction(activeBatch, async () =>
                Promise.all(actionBatchNumbers.map((batchNumber) =>
                  apiClient.post(`/6hi/orders/${encodeURIComponent(batchNumber)}/end`, { defectCodes }),
                )),
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

      {activeBatch && (
        <OrderRejectionModal
          open={rejectionOpen}
          batchNumber={activeBatch}
          orderLabel={modalOrderLabel}
          orderSubtitle={modalOrderSubtitle}
          onClose={() => setRejectionOpen(false)}
          onReject={async (batchNo, rejectionReason, defectCodes, remarks) => {
            await runOrderAction(batchNo, async () =>
              Promise.all(actionBatchNumbers.map((batchNumber) =>
                apiClient.post(`/6hi/orders/${encodeURIComponent(batchNumber)}/reject`, {
                  rejectionReason,
                  defectCodes,
                  remarks,
                }),
              )),
            );
            if (shiftLogId) await loadShiftSummary(shiftLogId);
            setCombinedRun(null);
            closeWorkspace();
          }}
        />
      )}
      
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
            <button type="button" className="underline text-xs" onClick={() => setStartError(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="fixed top-20 left-20 right-24 z-[105] max-w-lg mx-auto bg-destructive/10 border border-destructive text-destructive rounded-xl px-4 py-3 text-sm font-medium">
          <p>{actionError}</p>
          <button type="button" className="underline text-xs mt-2" onClick={() => setActionError(null)}>Dismiss</button>
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
            const targets = await resolveCombinedStoppageTargets(actionBatchNumbers, 'start', stoppageBatch);
            await runOrderAction(stoppageBatch, async () =>
              Promise.all(targets.map((batchNumber) =>
                apiClient.post(`/6hi/orders/${encodeURIComponent(batchNumber)}/stoppages`, {
                  categoryCode,
                  breakdownCode,
                  remarks,
                }),
              )),
            );
            if (shiftLogId) await loadShiftSummary(shiftLogId);
          }}
          onUpdate={async (stoppageId, categoryCode, breakdownCode, remarks) => {
            const targets = await resolveCombinedStoppageTargets(actionBatchNumbers, 'manage', stoppageBatch);
            await runOrderAction(stoppageBatch, async () =>
              Promise.all(targets.map(async (batchNumber) => {
                const targetStoppageId = batchNumber === activeBatch
                  ? stoppageId
                  : (await apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`)).activeStoppage?.id;
                if (!targetStoppageId) return null;
                return apiClient.patch(`/6hi/orders/${encodeURIComponent(batchNumber)}/stoppages/${encodeURIComponent(targetStoppageId)}`, {
                  categoryCode, breakdownCode, remarks,
                });
              })),
            );
            if (shiftLogId) await loadShiftSummary(shiftLogId);
          }}
          onEnd={async (stoppageId, categoryCode, breakdownCode, remarks) => {
            const targets = await resolveCombinedStoppageTargets(actionBatchNumbers, 'manage', stoppageBatch);
            await runOrderAction(stoppageBatch, async () => {
              await Promise.all(targets.map(async (batchNumber) => {
                const targetStoppageId = batchNumber === activeBatch
                  ? stoppageId
                  : (await apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`)).activeStoppage?.id;
                if (!targetStoppageId) return null;
                await apiClient.patch(`/6hi/orders/${encodeURIComponent(batchNumber)}/stoppages/${encodeURIComponent(targetStoppageId)}`, {
                  categoryCode, breakdownCode, remarks,
                });
                return apiClient.patch(`/6hi/orders/${encodeURIComponent(batchNumber)}/stoppages/${encodeURIComponent(targetStoppageId)}/end`, {});
              }));
              return null;
            });
            if (shiftLogId) await loadShiftSummary(shiftLogId);
          }}
          onRollChange={async (data) => {
            await runOrderAction(stoppageBatch, () =>
              apiClient.post(`/6hi/orders/${encodeURIComponent(stoppageBatch)}/roll-change`, data)
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
          await apiClient.post('/6hi/manual-stoppage/start', {
            machine: pathMill,
            categoryCode,
            breakdownCode,
            remarks,
          });
          await refreshMachineState();
        }}
        onUpdate={async (_stoppageId, categoryCode, breakdownCode, remarks) => {
          await apiClient.patch('/6hi/manual-stoppage', {
            machine: pathMill,
            categoryCode,
            breakdownCode,
            remarks,
          });
          await refreshMachineState();
        }}
        onEnd={async (_stoppageId, categoryCode, breakdownCode, remarks) => {
          await apiClient.patch('/6hi/manual-stoppage', {
            machine: pathMill,
            categoryCode,
            breakdownCode,
            remarks,
          });
          await apiClient.post('/6hi/manual-stoppage/end', { machine: pathMill });
          await refreshMachineState();
        }}
        onRollChange={async (data) => {
          const active = useSixHiStore.getState().manualStoppage?.active;
          if (!active) return;
          await apiClient.patch('/6hi/manual-stoppage', {
            machine: pathMill,
            categoryCode: active.categoryCode ?? '',
            breakdownCode: active.breakdownCode,
            remarks: active.reason,
            rollChange: data,
          });
          await refreshMachineState();
        }}
      />

      <SixHiManualOrderModal />

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

      {remarkOpen && activeBatch && (
        <OrderRemarkModal
          open={remarkOpen}
          batchNumber={activeBatch}
          orderLabel={modalOrderLabel}
          orderSubtitle={modalOrderSubtitle}
          busy={busy}
          onClose={() => setRemarkOpen(false)}
          onSave={async (text, defects) => {
            await runOrderAction(activeBatch, async () =>
              Promise.all(actionBatchNumbers.map((batchNumber) =>
                apiClient.post(`/6hi/orders/${encodeURIComponent(batchNumber)}/remarks`, { text, defects }),
              )),
            );
            setRemarkOpen(false);
          }}
        />
      )}
      </OperatorShell>
    </HandoverAcceptGate>
  );
}
