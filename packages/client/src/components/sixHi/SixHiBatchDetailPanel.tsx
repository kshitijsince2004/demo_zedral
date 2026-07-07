import type { SixHiQueueCard } from '@m1/shared-validation';
import { SixHiStatusPill } from './SixHiStatusPill';
import { SixHiBacklogBadge } from './SixHiBacklogBadge';
import { ZButton } from '../primitives/ZButton';
import { ArrowRightLeft, Play } from 'lucide-react';
import { finalOutputThicknessOf, finishOf, primaryOrderId, selectIdOf } from '../../lib/sixHiOrderIdentity';

interface SixHiBatchDetailPanelProps {
  batch: SixHiQueueCard | null;
  subProcessLabel: string;
  currentMill?: string;
  onOpen: () => void;
  onMoveToMachine?: () => void;
}

export function SixHiBatchDetailPanel({
  batch,
  subProcessLabel,
  currentMill,
  onOpen,
  onMoveToMachine,
}: SixHiBatchDetailPanelProps) {
  if (!batch) {
    return (
      <div className="bg-white border border-border rounded-2xl p-6 h-full flex items-center justify-center text-muted-foreground text-base">
        Select a batch to view order details
      </div>
    );
  }

  const isCompleted = batch.status === 'COMPLETED';
  const routeCode = batch.subProcess === 'ROLLING' ? '4' : 'X';
  const assignedToCurrentMill = batch.machineAllocated !== false
    && !!batch.machineCode
    && !!currentMill
    && batch.machineCode === currentMill;

  const fields: [string, string, boolean?][] = [
    ['Process Route', `${subProcessLabel} (route ${routeCode})`],
    ['Customer', batch.customer],
    ['Grade', batch.grade, true],
    ['Select ID', selectIdOf(batch), true],
    ['Batch Number', batch.batchNumber, true],
    ['Width', `${batch.widthMm} mm`, true],
    ['Input Thickness', `${batch.inputThkMm} mm`, true],
    ['Final Output Thickness', `${finalOutputThicknessOf(batch)} mm`, true],
    ['Finish', finishOf(batch), true],
    ['Weight', `${batch.weightMt} Metric Tons`, true],
  ];

  if (batch.planDate) {
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

  const primaryLabel = isCompleted
    ? 'Order Completed'
    : assignedToCurrentMill
      ? 'Open Production'
      : 'Move to Production…';

  return (
    <div className="bg-white border border-border rounded-2xl h-full flex flex-col shadow-sm overflow-hidden">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Order Details</p>
            <h2 className="font-mono text-2xl font-bold text-foreground mt-1 truncate">{primaryOrderId(batch)}</h2>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-1">
              Select ID {selectIdOf(batch)} · Batch {batch.batchNumber}
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
      </dl>

      <div className="shrink-0 mt-auto px-4 py-4 border-t border-border bg-secondary/30 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status</span>
          <SixHiStatusPill status={batch.status} prepReady={batch.prepReady} large />
        </div>
        {batch.activeStoppageCategory && (
          <p className="text-sm text-destructive font-semibold">Active: {batch.activeStoppageCategory}</p>
        )}
        <ZButton
          variant="accent"
          size="lg"
          fullWidth
          className="min-h-14 text-base font-bold disabled:opacity-70"
          onClick={onOpen}
          disabled={isCompleted}
        >
          <Play className="h-5 w-5" aria-hidden />
          {primaryLabel}
        </ZButton>
        {!isCompleted && batch.machineAllocated !== false && onMoveToMachine && (
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
