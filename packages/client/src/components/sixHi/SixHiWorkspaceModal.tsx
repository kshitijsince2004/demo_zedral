import { useEffect, useState, type ReactNode } from 'react';
import { X, AlertCircle } from 'lucide-react';
import type { SixHiOrderDetail, SixHiRollingData, SixHiSkinPassData } from '@m1/shared-validation';
import { useSixHiStore, isPreparing } from '../../store/sixHiStore';
import { apiClient } from '../../lib/apiClient';
import { patchQueued } from '../../lib/sync/queuedApi';
import { SixHiOrderWorkspace } from './SixHiOrderWorkspace';
import { SixHiStatusPill } from './SixHiStatusPill';
import { CombinedProductionOrdersPanel } from './CombinedProductionOrdersPanel';
import { CombinedProductionHistory } from './CombinedProductionHistory';
import { OrderDetailSlidePanel } from './OrderDetailSlidePanel';
import { orderIdentitySubtitle, displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import {
  allocateCombinedWeight,
  combinedTargetMt,
  resolveCombinedActualMt,
} from '../../lib/combinedWeightAllocation';

interface SixHiWorkspaceModalProps {
  actionRail?: ReactNode;
}

export function SixHiWorkspaceModal({ actionRail }: SixHiWorkspaceModalProps) {
  const {
    workspaceOpen,
    workspaceBatch,
    panelOrder,
    combinedRun,
    combinedSelectedBatches,
    busy,
    closeWorkspace,
    loadPanelOrder,
    runOrderAction,
  } = useSixHiStore();

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [combinedRefreshToken, setCombinedRefreshToken] = useState(0);
  const [combinedOrders, setCombinedOrders] = useState<SixHiOrderDetail[]>([]);
  const [detailBatch, setDetailBatch] = useState<string | null>(null);
  const [detailOrder, setDetailOrder] = useState<SixHiOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const pickedBatches = combinedRun
    ? combinedSelectedBatches.filter((b) => combinedRun.batchNumbers.includes(b))
    : [];
  const pickedPrimary = pickedBatches.length > 0
    ? (pickedBatches.includes(combinedRun?.primaryBatchNumber ?? '')
      ? combinedRun!.primaryBatchNumber
      : pickedBatches[0])
    : null;
  const formBatchNumber = pickedPrimary ?? combinedRun?.primaryBatchNumber ?? workspaceBatch;

  useEffect(() => {
    if (!workspaceOpen || !formBatchNumber) return;
    if (panelOrder?.batchNumber === formBatchNumber) return;
    void loadPanelOrder(formBatchNumber);
  }, [workspaceOpen, formBatchNumber, panelOrder?.batchNumber, loadPanelOrder]);

  const combinedBatchNumbersKey = combinedRun?.batchNumbers.join(',') ?? '';

  useEffect(() => {
    const batchNumbers = combinedBatchNumbersKey ? combinedBatchNumbersKey.split(',') : [];
    if (!workspaceOpen || batchNumbers.length <= 1) {
      setCombinedOrders([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      batchNumbers.map((batchNumber) =>
        apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`),
      ),
    ).then((orders) => {
      if (!cancelled) setCombinedOrders(orders);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceOpen, combinedBatchNumbersKey, combinedRefreshToken]);

  useEffect(() => {
    if (!workspaceOpen || !detailBatch) {
      setDetailOrder(null);
      return;
    }
    const cached = combinedOrders.find((o) => o.batchNumber === detailBatch)
      ?? (panelOrder?.batchNumber === detailBatch ? panelOrder : null);
    if (cached) {
      setDetailOrder(cached);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void apiClient
      .get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(detailBatch)}`)
      .then((loaded) => {
        if (!cancelled) setDetailOrder(loaded);
      })
      .catch(() => {
        if (!cancelled) setDetailOrder(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceOpen, detailBatch, combinedOrders, panelOrder]);

  useEffect(() => {
    if (!workspaceOpen) setDetailBatch(null);
  }, [workspaceOpen]);

  const combinedOrderCount = combinedRun?.batchNumbers.length ?? 0;
  const isCombined = combinedOrderCount > 1;
  const combinedActualMt = isCombined
    ? resolveCombinedActualMt(
      combinedOrders.map((o) => o.rolling?.actualWeightMt ?? o.skinPass?.actualWeightMt),
    )
    : undefined;

  if (!workspaceOpen || !workspaceBatch) return null;

  const order = panelOrder?.batchNumber === formBatchNumber ? panelOrder : null;
  const preparing = order ? isPreparing(order, workspaceOpen, workspaceBatch) : false;
  const actionBatchNumbers = combinedRun
    ? (pickedBatches.length > 0 ? pickedBatches : combinedRun.batchNumbers)
    : [workspaceBatch];
  const combinedTarget = isCombined && combinedRun
    ? combinedTargetMt(combinedRun.orders.map((o) => ({ targetMt: o.weightMt })))
    : undefined;
  const isTerminalCombined = isCombined && order && (order.status === 'COMPLETED' || order.status === 'REJECTED');
  const canSelectOrders = preparing && isCombined && !isTerminalCombined;

  const patchCombinedProduction = async <T extends { actualWeightMt?: number }>(
    endpoint: 'rolling' | 'skinpass',
    data: T,
  ) => {
    if (!isCombined || !combinedRun) {
      await Promise.all(actionBatchNumbers.map((batchNumber) =>
        patchQueued(`/6hi/orders/${encodeURIComponent(batchNumber)}/${endpoint}`, data, `6hi-order:${batchNumber}`),
      ));
      return;
    }

    const targets = combinedRun.orders.map((o) => ({
      batchNumber: o.batchNumber,
      targetMt: o.weightMt,
    }));
    const allocation = data.actualWeightMt != null
      ? allocateCombinedWeight(targets, data.actualWeightMt)
      : null;

    await Promise.all(actionBatchNumbers.map((batchNumber) => {
      const payload = {
        ...data,
        actualWeightMt: allocation?.get(batchNumber) ?? data.actualWeightMt,
      };
      return patchQueued(
        `/6hi/orders/${encodeURIComponent(batchNumber)}/${endpoint}`,
        payload,
        `6hi-order:${batchNumber}`,
      );
    }));
  };

  const handleSaveRolling = async (data: SixHiRollingData) => {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await runOrderAction(workspaceBatch, async () => patchCombinedProduction('rolling', data));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      if (combinedRun) setCombinedRefreshToken((t) => t + 1);
      useSixHiStore.getState().requestQueueRefresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save production data. Please try again.');
    }
  };

  const handleSaveSkinPass = async (data: SixHiSkinPassData) => {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await runOrderAction(workspaceBatch, async () => patchCombinedProduction('skinpass', data));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      if (combinedRun) setCombinedRefreshToken((t) => t + 1);
      useSixHiStore.getState().requestQueueRefresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save production data. Please try again.');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-primary/40 backdrop-blur-[2px]" onClick={closeWorkspace} aria-hidden />
      <div
        className="fixed inset-y-0 left-16 right-0 z-[95] flex overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Production workspace"
      >
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-secondary">
          <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-primary text-white h-16">
            <div className="flex items-center gap-3 min-w-0">
              <p className="text-base font-bold shrink-0">Production Console</p>
              {order && (
                <>
                  {isCombined ? (
                    <span className="font-mono text-lg font-bold truncate">
                      Combined run · {combinedRun!.batchNumbers.length} orders
                    </span>
                  ) : (
                    <span className="font-mono text-lg font-bold truncate">{displayMotherCoilId(order)}</span>
                  )}
                  <SixHiStatusPill status={order.status} preparing={preparing} large />
                  <span className="text-sm opacity-80 hidden sm:inline">
                    {isCombined
                      ? combinedRun!.batchNumbers.join(', ')
                      : orderIdentitySubtitle(order)}
                  </span>
                  {!isCombined && (
                    <button
                      type="button"
                      onClick={() => setDetailBatch(workspaceBatch)}
                      className="hidden sm:inline-flex text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25"
                    >
                      Order details
                    </button>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={closeWorkspace}
              className="min-h-10 min-w-10 flex items-center justify-center rounded-lg hover:bg-white/10 shrink-0"
              aria-label="Close workspace"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {saveError && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{saveError}</span>
              <button type="button" className="underline text-xs" onClick={() => setSaveError(null)}>Dismiss</button>
            </div>
          )}

          {saveSuccess && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-green-500/10 border-b border-green-500/20 text-green-700 text-sm">
              <span className="flex-1 font-semibold">Production data saved successfully.</span>
            </div>
          )}

          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {combinedRun && combinedOrderCount > 1 && !isTerminalCombined && (
                <CombinedProductionOrdersPanel
                  combinedRun={combinedRun}
                  refreshToken={combinedRefreshToken}
                  selectedBatch={detailBatch}
                  onSelectBatch={setDetailBatch}
                  selectable={canSelectOrders}
                />
              )}

              <div className="p-2 flex flex-col min-h-0">
                {!order && <p className="text-center text-muted-foreground py-16">Loading order…</p>}
                {order && isTerminalCombined && combinedOrders.length > 1 && (
                  <div className="bg-white border border-border rounded-xl p-4">
                    <CombinedProductionHistory orders={combinedOrders} />
                  </div>
                )}
                {order && !isTerminalCombined && (
                  <SixHiOrderWorkspace
                    order={order}
                    workspaceOpen={workspaceOpen}
                    workspaceBatch={workspaceBatch}
                    busy={busy}
                    compact
                    combinedOrderCount={isCombined ? combinedOrderCount : undefined}
                    combinedTargetMt={combinedTarget}
                    combinedActualMt={combinedActualMt}
                    hidePpcDetail={isCombined || !!detailBatch}
                    onSaveRolling={handleSaveRolling}
                    onSaveSkinPass={handleSaveSkinPass}
                  />
                )}
              </div>
            </div>

            {detailBatch && (
              <OrderDetailSlidePanel
                order={detailOrder ?? (detailBatch === order?.batchNumber ? order : null)}
                loading={detailLoading}
                onClose={() => setDetailBatch(null)}
              />
            )}
          </div>
        </div>

        {actionRail}
      </div>
    </>
  );
}
