import { useEffect, useState } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
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
import { OrderRejectionModal } from './OrderRejectionModal';
import { OrderEndModal } from './OrderEndModal';
import { SixHiManualOrderModal } from './SixHiManualOrderModal';
import { ZButton } from '../primitives/ZButton';
import { OrderRemarkModal } from './OrderRemarkModal';

export function SixHiLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { machineCode: pathMill } = useWorkspaceBase();
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const logout = useAuthStore((s) => s.logout);
  const { shiftLogId } = useShiftStore();

  const {
    workspaceOpen,
    workspaceBatch,
    panelOrder,
    busy,
    openWorkspace,
    closeWorkspace,
    loadPanelOrder,
    runOrderAction,
    refreshMachineState,
    loadShiftSummary,
    machineActive,
    setMachineCode,
  } = useSixHiStore();

  const [stoppageOpen, setStoppageOpen] = useState(false);
  const [rejectionOpen, setRejectionOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [startError, setStartError] = useState<{ message: string; activeBatch?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      requestStoppageDialog: async (batchNo: string) => {
        setActionError(null);
        const store = useSixHiStore.getState();
        if (store.panelOrder?.batchNumber !== batchNo) {
          await store.loadPanelOrder(batchNo);
        }
        const order = useSixHiStore.getState().panelOrder;
        const canStartStoppage =
          order?.status === 'IN_PROGRESS' ||
          (order?.status === 'STOPPAGE' && !order?.activeStoppage);
        if (!order || order.batchNumber !== batchNo) {
          throw new Error('Order not found');
        }
        if (!canStartStoppage && !order.activeStoppage) {
          throw new Error('Start production before recording a stoppage');
        }
        if (!order.activeStoppage) {
          await store.runOrderAction(batchNo, () =>
            apiClient.post(`/6hi/orders/${encodeURIComponent(batchNo)}/stoppages/start`, {}),
          );
        }
        setStoppageOpen(true);
      },
      requestRejectionDialog: (batchNo: string) => {
        setRejectionOpen(true);
      }
    });
    return () => useSixHiStore.setState({ 
      requestStoppageDialog: undefined,
      requestRejectionDialog: undefined,
    });
  }, []);

  const activeBatch = workspaceBatch ?? panelOrder?.batchNumber ?? machineActive?.batchNumber;
  const showPanel = panelOrder && shouldShowProductionPanel(panelOrder, workspaceOpen, workspaceBatch);

  const handleStart = async () => {
    if (!activeBatch) return;
    setStartError(null);
    try {
      await runOrderAction(activeBatch, () =>
        apiClient.post(`/6hi/orders/${encodeURIComponent(activeBatch)}/start`, {}),
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

  const handleEnd = () => {
    if (!activeBatch) return;
    setEndOpen(true);
  };

  const actionRailProps = panelOrder
    ? {
        order: panelOrder,
        workspaceOpen,
        workspaceBatch,
        busy,
        onStart: handleStart,
        onEnd: handleEnd,
        onReject: () => setRejectionOpen(true),
        onRemark: () => setRemarkOpen(true),
        onViewOrder: () => openWorkspace(panelOrder.batchNumber),
        onCloseWorkspace: workspaceOpen ? closeWorkspace : undefined,
      }
    : null;

  return (
    <HandoverAcceptGate machineCode={pathMill}>
      <OperatorShell processCode={pathMill}>
        <div className={showPanel && !workspaceOpen ? 'pr-[6.5rem]' : ''}>
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
          onClose={() => setEndOpen(false)}
          onConfirm={async (defectCodes) => {
            try {
              await runOrderAction(activeBatch, () =>
                apiClient.post(`/6hi/orders/${encodeURIComponent(activeBatch)}/end`, { defectCodes }),
              );
              if (shiftLogId) await loadShiftSummary(shiftLogId);
              closeWorkspace();
            } catch (err) {
              if (err instanceof ApiError && err.status === 400) {
                setStartError(err.message);
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
          onClose={() => setRejectionOpen(false)}
          onReject={async (batchNo, rejectionReason, defectCodes, remarks) => {
            await runOrderAction(batchNo, () =>
              apiClient.post(`/6hi/orders/${encodeURIComponent(batchNo)}/reject`, {
                rejectionReason,
                defectCodes,
                remarks,
              }),
            );
            if (shiftLogId) await loadShiftSummary(shiftLogId);
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

      {activeBatch && (
        <OrderStoppageModal
          open={stoppageOpen}
          hasActiveStoppage={!!activeStoppage}
          activeStoppage={activeStoppage}
          onClose={() => setStoppageOpen(false)}
          onUpdate={async (stoppageId, categoryCode, breakdownCode, remarks) => {
            await runOrderAction(activeBatch, () =>
              apiClient.patch(`/6hi/orders/${encodeURIComponent(activeBatch)}/stoppages/${encodeURIComponent(stoppageId)}`, {
                categoryCode, breakdownCode, remarks,
              })
            );
            if (shiftLogId) await loadShiftSummary(shiftLogId);
          }}
          onEnd={async (stoppageId, categoryCode, breakdownCode, remarks) => {
            await runOrderAction(activeBatch, async () => {
              // first update the details
              await apiClient.patch(`/6hi/orders/${encodeURIComponent(activeBatch)}/stoppages/${encodeURIComponent(stoppageId)}`, {
                categoryCode, breakdownCode, remarks,
              });
              // then end it
              return apiClient.patch(`/6hi/orders/${encodeURIComponent(activeBatch)}/stoppages/${encodeURIComponent(stoppageId)}/end`, {});
            });
            if (shiftLogId) await loadShiftSummary(shiftLogId);
          }}
          onRollChange={async (data) => {
            await runOrderAction(activeBatch, () =>
              apiClient.post(`/6hi/orders/${encodeURIComponent(activeBatch)}/roll-change`, data)
            );
          }}
        />
      )}

      <SixHiManualOrderModal />

      {remarkOpen && activeBatch && (
        <OrderRemarkModal
          open={remarkOpen}
          batchNumber={activeBatch}
          busy={busy}
          onClose={() => setRemarkOpen(false)}
          onSave={async (text, defects) => {
            await runOrderAction(activeBatch, () =>
              apiClient.post(`/6hi/orders/${encodeURIComponent(activeBatch)}/remarks`, { text, defects }),
            );
            setRemarkOpen(false);
          }}
        />
      )}
      </OperatorShell>
    </HandoverAcceptGate>
  );
}
