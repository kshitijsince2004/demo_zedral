import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Play } from 'lucide-react';
import { useSixHiStore } from '../../store/sixHiStore';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useShiftStore } from '../../store/shiftStore';
import { SixHiShiftSummaryPanel } from '../../components/sixHi/SixHiShiftSummaryPanel';
import { SixHiStatusPill } from '../../components/sixHi/SixHiStatusPill';
import { OrderStoppageTable } from '../../components/sixHi/OrderStoppageTable';
import { ZButton } from '../../components/primitives/ZButton';
import { useElapsedTimer } from '../../hooks/useElapsedTimer';
import useSWR from 'swr';
import { apiClient } from '../../lib/apiClient';

export function SixHiCapturePage() {
  const navigate = useNavigate();
  const { basePath } = useWorkspaceBase();
  const { shiftLogId, shiftDate, shiftCode } = useShiftStore();
  const {
    panelOrder,
    machineActive,
    machineCode,
    shiftSummary,
    openWorkspace,
    loadPanelOrder,
    loadShiftSummary,
    refreshMachineState,
    requestStoppageDialog,
  } = useSixHiStore();

  useEffect(() => {
    refreshMachineState();
    if (shiftLogId) loadShiftSummary(shiftLogId);
    const id = setInterval(() => {
      const store = useSixHiStore.getState();
      void store.refreshMachineState();
      const batch = store.machineActive?.batchNumber;
      if (batch) void store.loadPanelOrder(batch);
    }, 15000);
    return () => clearInterval(id);
  }, [shiftLogId, refreshMachineState, loadShiftSummary]);

  const activeBatch = machineActive?.batchNumber ?? null;

  useEffect(() => {
    if (activeBatch && (!panelOrder || panelOrder.batchNumber !== activeBatch)) {
      loadPanelOrder(activeBatch);
    }
  }, [activeBatch, panelOrder, loadPanelOrder]);

  const order = activeBatch && panelOrder?.batchNumber === activeBatch ? panelOrder : null;

  const { data: queueData } = useSWR(machineCode ? `/6hi/queue?machine=${machineCode}` : null, async (url) => {
    return apiClient.get(url);
  });
  const allQueueItems = [...(queueData?.queue ?? queueData ?? [])];
  const nextOrder = allQueueItems.find(q => q.status === 'PREPARING') || allQueueItems[0];

  const openStoppage = () => {
    if (order?.batchNumber) requestStoppageDialog?.(order.batchNumber);
  };
  const liveRuntime = useElapsedTimer(order?.status === 'IN_PROGRESS' ? order?.prodStartAt : undefined);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-secondary p-4 md:p-5 gap-4 overflow-hidden">
      <div className="shrink-0">
        <h1 className="text-xl font-bold text-foreground">Capture</h1>
        <p className="text-sm text-muted-foreground">{machineCode} · Shift {shiftCode} · {shiftDate}</p>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="flex flex-col min-h-0 gap-4 overflow-auto">
          {!order && (
            <div className="bg-white border border-border rounded-2xl p-8 text-center flex flex-col items-center justify-center min-h-[240px]">
              <p className="text-lg font-semibold text-foreground mb-2">No Active Work Order</p>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                One order runs at a time on {machineCode}. Start production from Orders to see the active order here.
              </p>
              <ZButton variant="accent" size="lg" onClick={() => navigate(basePath)} className="min-h-14 px-8">
                <ArrowRight className="h-5 w-5" />
                Go to Orders
              </ZButton>
            </div>
          )}

          {order && (
            <>
              <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-primary text-white px-5 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Active Work Order</p>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-mono text-2xl font-bold text-foreground">{order.batchNumber}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {order.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass'} · {order.customer}
                      </p>
                    </div>
                    <SixHiStatusPill status={order.status} />
                  </div>

                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    {[
                      ['Mother Coil', `${order.motherCoil}${order.slitId ? `/${order.slitId}` : ''}`],
                      ['Grade', order.grade],
                      ['Width', `${order.widthMm} mm`],
                      ['Input Thk', `${order.inputThkMm} mm`],
                      ['Target Thk', `${order.targetThkMm} mm`],
                      ['Weight', `${order.ppcWeightMt} MT`],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-secondary rounded-xl px-3 py-3 min-h-[64px]">
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
                        <dd className="font-mono text-sm font-semibold text-foreground mt-1">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {order.prodDurationMin != null ? (
                    <p className="text-sm text-muted-foreground">
                      Runtime: <span className="font-mono font-semibold text-foreground">{order.prodDurationMin} min</span>
                    </p>
                  ) : order.status === 'IN_PROGRESS' && order.prodStartAt ? (
                    <p className="text-sm text-amber-600 font-semibold flex items-center gap-2">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                      </span>
                      Runtime: <span className="font-mono">{liveRuntime}</span>
                      <span className="text-xs text-muted-foreground font-normal ml-2">(Running Since: {new Date(order.prodStartAt).toLocaleTimeString()})</span>
                    </p>
                  ) : null}

                  <ZButton
                    variant="accent"
                    size="lg"
                    fullWidth
                    className="min-h-14"
                    onClick={() => openWorkspace(order.batchNumber)}
                  >
                    <Play className="h-5 w-5" />
                    Open Production Form
                  </ZButton>
                </div>
              </div>

              <OrderStoppageTable
                stoppages={order.stoppages}
                hasActiveStoppage={!!order.activeStoppage}
                onLogStoppage={openStoppage}
                onEndStoppage={openStoppage}
              />
            </>
          )}

          {nextOrder && (
            <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm mt-4">
              <div className="bg-muted text-muted-foreground px-5 py-3 border-b border-border flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest">Next Prepared Order</p>
                <span className="text-xs font-semibold bg-white/50 px-2 py-0.5 rounded">Queue Pos: {nextOrder.queuePosition}</span>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-xl font-bold text-foreground">{nextOrder.batchNumber}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {nextOrder.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass'} · {nextOrder.customer}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Planned Qty</p>
                    <p className="font-mono font-semibold">{nextOrder.weightMt} MT</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-auto">
          <SixHiShiftSummaryPanel summary={shiftSummary} />
        </div>
      </div>
    </div>
  );
}
