import { useEffect, useState } from 'react';
import type { SixHiQueueCard, SixHiOrderDetail } from '@m1/shared-validation';
import { SixHiStatusPill } from './SixHiStatusPill';
import { SixHiBacklogBadge } from './SixHiBacklogBadge';
import { ZButton } from '../primitives/ZButton';
import { ArrowRightLeft, Eye, Play } from 'lucide-react';
import { finalOutputThicknessOf, finishOf, primaryOrderId, selectIdOf } from '../../lib/sixHiOrderIdentity';
import { apiClient } from '../../lib/apiClient';
import { OrderProductionHistory } from './OrderProductionHistory';

interface SixHiBatchDetailPanelProps {
  batch: SixHiQueueCard | null;
  subProcessLabel: string;
  currentMill?: string;
  machineActiveBatch?: string | null;
  combinedCount?: number;
  combinedBatchNumbers?: string[];
  onOpen: () => void;
  onViewCompleted?: () => void;
  onMoveToMachine?: () => void;
}

export function SixHiBatchDetailPanel({
  batch,
  subProcessLabel,
  currentMill,
  machineActiveBatch,
  combinedCount = 1,
  combinedBatchNumbers = [],
  onOpen,
  onViewCompleted,
  onMoveToMachine,
}: SixHiBatchDetailPanelProps) {
  const [orderDetail, setOrderDetail] = useState<SixHiOrderDetail | null>(null);
  const [combinedDetails, setCombinedDetails] = useState<SixHiOrderDetail[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const isCompleted = batch?.status === 'COMPLETED';
  const isRejected = batch?.status === 'REJECTED';
  const isTerminal = isCompleted || isRejected;
  const isCombinedTerminal = isTerminal && combinedCount > 1 && combinedBatchNumbers.length > 1;
  const isActiveOnMachine = batch?.batchNumber === machineActiveBatch;

  useEffect(() => {
    if (!batch || !isTerminal) {
      setOrderDetail(null);
      setCombinedDetails([]);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);

    const batchesToLoad = isCombinedTerminal ? combinedBatchNumbers : [batch.batchNumber];
    void Promise.all(
      batchesToLoad.map((batchNumber) =>
        apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`),
      ),
    )
      .then((orders) => {
        if (cancelled) return;
        setCombinedDetails(orders);
        setOrderDetail(orders.find((o) => o.batchNumber === batch.batchNumber) ?? orders[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setOrderDetail(null);
          setCombinedDetails([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [batch?.batchNumber, isTerminal, isCombinedTerminal, combinedBatchNumbers.join(',')]);

  if (!batch) {
    return (
      <div className="bg-white border border-border rounded-2xl p-6 h-full flex items-center justify-center text-muted-foreground text-base">
        Select a batch to view order details
      </div>
    );
  }

  const routeCode = batch.subProcess === 'ROLLING' ? '4' : 'X';
  const assignedToCurrentMill = batch.machineAllocated !== false
    && !!batch.machineCode
    && !!currentMill
    && batch.machineCode === currentMill;

  const fields: [string, string, boolean?][] = [
    ['Process Route', `${subProcessLabel} (route ${routeCode})`],
    ['Customer', batch.customer],
    ['Grade', batch.grade, true],
    ['Slit ID', selectIdOf(batch), true],
    ['Batch Number', batch.batchNumber, true],
    ['Width', `${batch.widthMm} mm`, true],
    ['Input Thickness', `${batch.inputThkMm} mm`, true],
    ['Final Output Thickness', `${finalOutputThicknessOf(batch)} mm`, true],
    ['Finish', finishOf(batch), true],
    ['Weight', `${batch.weightMt} Metric Tons`, true],
  ];

  if (batch.isBacklog && batch.planDate) {
    fields.splice(1, 0, ['Planned Date', `${batch.planDate}${batch.shiftCode ? ` · Shift ${batch.shiftCode}` : ''}`]);
  }

  if (batch.machineAllocated === false) {
    const hint = batch.suggestedMachineCode;
    fields.splice(1, 0, ['Assigned Mill', hint ? `Unassigned · hint ${hint}` : 'Unassigned — select mill']);
  } else if (batch.machineCode) {
    fields.splice(1, 0, ['Assigned Mill', batch.machineCode]);
  }

  if (batch.rollingPassNo && batch.rollingPassNo > 1) {
    fields.push(['Rolling Pass', `Pass ${batch.rollingPassNo}`]);
  }
  if (batch.destination) {
    fields.push(['Destination', batch.destination === 'REWINDING' ? 'Rewinding' : 'Annealing']);
  }
  if (batch.rollFinish) {
    fields.push(['Roll Finish', batch.rollFinish]);
  }
  if (batch.rerollFlag != null) {
    fields.push(['Re-Roll', batch.rerollFlag ? 'Yes' : 'No']);
  }

  const primaryLabel = isTerminal
    ? combinedCount > 1
      ? `View Combined History (${combinedCount})`
      : isRejected
        ? 'View Rejection Details'
        : 'View Production History'
    : combinedCount > 1
      ? `Start Combined Production (${combinedCount})`
      : assignedToCurrentMill
        ? 'Open Production'
        : 'Move to Production…';

  return (
    <div className="bg-white border border-border rounded-2xl h-full flex flex-col shadow-sm overflow-hidden">
      {isActiveOnMachine && (
        <div className="shrink-0 px-4 py-2 bg-warning/15 border-b border-warning/30 text-warning text-xs font-bold uppercase tracking-widest">
          Active on this machine
        </div>
      )}

      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Order Details</p>
            <h2 className="font-mono text-2xl font-bold text-foreground mt-1 truncate">{primaryOrderId(batch)}</h2>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-1">
              Slit ID {selectIdOf(batch)} · Batch {batch.batchNumber}
            </p>
          </div>
          {batch.isBacklog && <SixHiBacklogBadge planDate={batch.planDate} large />}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-3 flex-1 min-h-0 overflow-y-auto content-start">
        {fields.map(([k, v, mono]) => (
          <div key={k}>
            <dt className="text-muted-foreground text-[11px] uppercase tracking-wide leading-tight font-semibold">{k}</dt>
            <dd className={`font-bold mt-1 text-sm leading-snug text-foreground ${mono ? 'font-mono' : ''}`}>{v}</dd>
          </div>
        ))}

        {loadingDetail && isTerminal && (
          <p className="col-span-2 text-sm text-muted-foreground">Loading production history…</p>
        )}
        {isCombinedTerminal && combinedDetails.length > 0 && (
          <div className="col-span-2 space-y-4">
            <p className="text-xs font-semibold text-success">
              Combined run · {combinedDetails.length} orders
            </p>
            {combinedDetails.map((order) => (
              <div key={order.batchNumber} className="rounded-xl border border-border bg-secondary/20 p-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                  Batch {order.batchNumber}
                </p>
                <OrderProductionHistory order={order} />
              </div>
            ))}
          </div>
        )}
        {!isCombinedTerminal && orderDetail && isTerminal && (
          <div className="col-span-2"><OrderProductionHistory order={orderDetail} /></div>
        )}
      </dl>

      <div className="shrink-0 mt-auto px-4 py-4 border-t border-border bg-secondary/30 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status</span>
          <SixHiStatusPill status={batch.status} prepReady={batch.prepReady} large />
        </div>
        {batch.activeStoppageCategory && (
          <p className="text-sm text-destructive font-semibold">Active: {batch.activeStoppageCategory}</p>
        )}
        {combinedCount > 1 && (
          <p className="text-xs text-success font-semibold">
            {combinedCount} compatible orders selected{isTerminal ? ' for combined history' : ' for combined production'}
          </p>
        )}
        <ZButton
          variant="accent"
          size="lg"
          fullWidth
          className="min-h-14 text-base font-bold disabled:opacity-70"
          onClick={isTerminal ? (onViewCompleted ?? onOpen) : onOpen}
          disabled={isTerminal && !onViewCompleted && !orderDetail}
        >
          {isTerminal ? <Eye className="h-5 w-5" aria-hidden /> : <Play className="h-5 w-5" aria-hidden />}
          {primaryLabel}
        </ZButton>
        {!isTerminal && batch.machineAllocated !== false && onMoveToMachine && (
          <ZButton
            variant="secondary"
            size="lg"
            fullWidth
            className="min-h-12 text-base font-bold"
            onClick={onMoveToMachine}
          >
            <ArrowRightLeft className="h-5 w-5" aria-hidden />
            Move to Machine
          </ZButton>
        )}
      </div>
    </div>
  );
}
