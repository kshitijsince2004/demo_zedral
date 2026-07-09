import { useEffect, useState, type ReactNode } from 'react';
import { X, AlertCircle } from 'lucide-react';
import type { SixHiRollingData, SixHiSkinPassData } from '@m1/shared-validation';
import { useSixHiStore, isPreparing } from '../../store/sixHiStore';
import { apiClient } from '../../lib/apiClient';
import { SixHiOrderWorkspace } from './SixHiOrderWorkspace';
import { SixHiStatusPill } from './SixHiStatusPill';
import { CombinedProductionOrdersPanel } from './CombinedProductionOrdersPanel';
import { orderIdentitySubtitle, primaryOrderId } from '../../lib/sixHiOrderIdentity';

interface SixHiWorkspaceModalProps {
  actionRail?: ReactNode;
}

export function SixHiWorkspaceModal({ actionRail }: SixHiWorkspaceModalProps) {
  const {
    workspaceOpen,
    workspaceBatch,
    panelOrder,
    combinedRun,
    busy,
    closeWorkspace,
    loadPanelOrder,
    runOrderAction,
    setCombinedRun,
  } = useSixHiStore();

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [combinedRefreshToken, setCombinedRefreshToken] = useState(0);

  const formBatchNumber = combinedRun?.primaryBatchNumber ?? workspaceBatch;

  useEffect(() => {
    if (workspaceOpen && formBatchNumber) {
      loadPanelOrder(formBatchNumber);
    }
  }, [workspaceOpen, formBatchNumber, loadPanelOrder]);

  if (!workspaceOpen || !workspaceBatch) return null;

  const order = panelOrder?.batchNumber === formBatchNumber ? panelOrder : null;
  const combinedOrderCount = combinedRun?.batchNumbers.length ?? 0;
  const preparing = order ? isPreparing(order, workspaceOpen, workspaceBatch) : false;
  const actionBatchNumbers = combinedRun?.batchNumbers.length ? combinedRun.batchNumbers : [workspaceBatch];

  const handleSaveRolling = async (data: SixHiRollingData) => {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await runOrderAction(workspaceBatch, async () =>
        Promise.all(actionBatchNumbers.map((batchNumber) =>
          apiClient.patch(`/6hi/orders/${encodeURIComponent(batchNumber)}/rolling`, data),
        )),
      );
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
      await runOrderAction(workspaceBatch, async () =>
        Promise.all(actionBatchNumbers.map((batchNumber) =>
          apiClient.patch(`/6hi/orders/${encodeURIComponent(batchNumber)}/skinpass`, data),
        )),
      );
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
                  <span className="font-mono text-lg font-bold truncate">{primaryOrderId(order)}</span>
                  <SixHiStatusPill status={order.status} preparing={preparing} large />
                  <span className="text-sm opacity-80 hidden sm:inline">
                    {combinedRun ? `${combinedRun.batchNumbers.length} orders` : orderIdentitySubtitle(order)}
                  </span>
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

          {combinedRun && (
            <CombinedProductionOrdersPanel
              combinedRun={combinedRun}
              refreshToken={combinedRefreshToken}
            />
          )}

          <div className="flex-1 min-h-0 p-2 overflow-hidden">
            {!order && <p className="text-center text-muted-foreground py-16">Loading order…</p>}
            {order && (
              <SixHiOrderWorkspace
                order={order}
                workspaceOpen={workspaceOpen}
                workspaceBatch={workspaceBatch}
                busy={busy}
                compact
                combinedOrderCount={combinedOrderCount > 1 ? combinedOrderCount : undefined}
                onSaveRolling={handleSaveRolling}
                onSaveSkinPass={handleSaveSkinPass}
              />
            )}
          </div>
        </div>

        {actionRail}
      </div>
    </>
  );
}
