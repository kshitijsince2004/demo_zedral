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
import { HandoverAcceptGate } from '../HandoverAcceptGate';
import { machineHandoverService } from '../../services/machineHandoverService';
import { SixHiWorkspaceModal } from './SixHiWorkspaceModal';
import { SixHiGlobalProductionPanel } from './SixHiGlobalProductionPanel';
import { OrderStoppageModal } from './OrderStoppageModal';
import { OrderRejectionModal } from './OrderRejectionModal';
import { OrderEndModal } from './OrderEndModal';
import { SixHiManualOrderModal } from './SixHiManualOrderModal';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';

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
  const [remarkText, setRemarkText] = useState('');
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    setMachineCode(pathMill);
  }, [pathMill, setMachineCode]);

  useEffect(() => {
    async function init() {
      try {
        await bootstrapShiftContext(pathMill);
        await machineHandoverService.ensureSession(pathMill).catch(() => undefined);
        const data = await apiClient.get(`/shift-logs/active/${CRM_SHIFT_PROCESS_CODE}`);
        useShiftStore.setState({
          shiftLogId: data.shiftLogId,
          shiftDate: data.shiftDate,
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
        const store = useSixHiStore.getState();
        const order = store.panelOrder;
        if (!order?.activeStoppage) {
          // Immediate stoppage start
          await store.runOrderAction(batchNo, () =>
            apiClient.post(`/6hi/orders/${encodeURIComponent(batchNo)}/stoppages/start`, {})
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
        setStartError(`Order ${body?.activeBatchNumber ?? 'unknown'} is already active. One machine — one order.`);
      } else {
        throw err;
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
        onStoppage: () => setStoppageOpen(true),
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
          onReject={async (batchNo, defectCodes, remarks) => {
            await runOrderAction(batchNo, () =>
              apiClient.post(`/6hi/orders/${encodeURIComponent(batchNo)}/reject`, {
                defectCodes,
                remarks,
              })
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
        <div className="fixed top-20 left-20 right-24 z-[105] max-w-lg mx-auto bg-destructive/10 border border-destructive text-destructive rounded-xl px-4 py-3 text-sm font-medium">
          {startError}
          <button type="button" className="ml-2 underline" onClick={() => setStartError(null)}>Dismiss</button>
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
              apiClient.post(`/6hi/orders/${encodeURIComponent(activeBatch)}/roll-changes`, data)
            );
          }}
        />
      )}

      <SixHiManualOrderModal />

      {remarkOpen && activeBatch && (
        <>
          <button type="button" className="fixed inset-0 z-[110] bg-background/70" onClick={() => setRemarkOpen(false)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] max-w-md mx-auto border border-border bg-card rounded-2xl p-4 space-y-3 shadow-xl">
            <h3 className="font-semibold text-lg">Add Remark</h3>
            <ZInput value={remarkText} onChange={(e) => setRemarkText(e.target.value)} placeholder="Enter remark…" className="min-h-14 text-lg" />
            <div className="flex gap-2 justify-end">
              <ZButton variant="ghost" onClick={() => setRemarkOpen(false)}>Cancel</ZButton>
              <ZButton
                variant="accent"
                disabled={!remarkText.trim() || busy}
                onClick={() =>
                  runOrderAction(activeBatch, () =>
                    apiClient.post(`/6hi/orders/${encodeURIComponent(activeBatch)}/remarks`, { text: remarkText }),
                  ).then(() => {
                    setRemarkText('');
                    setRemarkOpen(false);
                  })
                }
              >
                Save
              </ZButton>
            </div>
          </div>
        </>
      )}
      </OperatorShell>
    </HandoverAcceptGate>
  );
}
