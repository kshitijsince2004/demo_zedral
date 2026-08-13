import { memo, type MouseEvent } from 'react';
import type { SixHiQueueCard } from '@m1/shared-validation';
import { SixHiStatusPill } from './SixHiStatusPill';
import { SixHiBacklogBadge } from './SixHiBacklogBadge';
import {
  displayMotherCoilId,
  finishOf,
} from '../../lib/sixHiOrderIdentity';

export interface SixHiQueueRowProps {
  card: SixHiQueueCard;
  isSelected: boolean;
  isTransferMode: boolean;
  isInCombinedSelection: boolean;
  showCombineCheckbox: boolean;
  isActive: boolean;
  combinedSelectionCount: number;
  isEnding?: boolean;
  pending?: boolean;
  /** Display-only manual re-roll overlay (does not mutate CRM card). */
  wasRerolled?: boolean;
  lastRerolledThicknessMm?: number | null;
  onSelect: (card: SixHiQueueCard) => void;
  onTransferToggle: (batchNumber: string) => void;
  onCombineToggle: (batchNumber: string, event: MouseEvent) => void;
}

export const SixHiQueueRow = memo(function SixHiQueueRow({
  card,
  isSelected,
  isTransferMode,
  isInCombinedSelection,
  showCombineCheckbox,
  isActive,
  combinedSelectionCount,
  isEnding,
  pending,
  wasRerolled,
  lastRerolledThicknessMm,
  onSelect,
  onTransferToggle,
  onCombineToggle,
}: SixHiQueueRowProps) {
  const routeCode = card.subProcess === 'ROLLING' ? '4' : 'X';
  const displayTarget = wasRerolled && lastRerolledThicknessMm != null
    ? lastRerolledThicknessMm
    : card.targetThkMm;

  return (
    <button
      type="button"
      onClick={() => {
        if (isTransferMode) onTransferToggle(card.batchNumber);
        else onSelect(card);
      }}
      className={[
        'w-full text-left border-b border-border px-5 py-4 transition-colors min-h-[88px]',
        'hover:bg-secondary active:bg-secondary',
        isSelected ? 'bg-accent/10 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent',
        isSelected && isTransferMode ? 'bg-primary/5 border-l-4 border-l-primary' : '',
        isInCombinedSelection && combinedSelectionCount > 1 ? 'ring-1 ring-inset ring-success/25' : '',
        isActive ? 'ring-1 ring-inset ring-warning/30' : '',
        pending ? 'bg-secondary/40' : '',
        card.isBacklog ? 'bg-destructive/5' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <RowTitle
          card={card}
          showCombineCheckbox={showCombineCheckbox}
          isInCombinedSelection={isInCombinedSelection}
          onCombineToggle={onCombineToggle}
        />
        <div className="flex items-center gap-2">
          {card.isBacklog && <SixHiBacklogBadge planDate={card.planDate} />}
          {wasRerolled && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-primary/15 text-primary">
              Re-rolled
            </span>
          )}
          {isInCombinedSelection && combinedSelectionCount > 1 && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-success/15 text-success">
              Combined
            </span>
          )}
          {pending && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-warning/15 text-warning">
              Awaiting mill
            </span>
          )}
          {isEnding && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-warning/15 text-warning">
              Ending…
            </span>
          )}
          <SixHiStatusPill status={card.status} prepReady={card.prepReady} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="truncate">{card.customer}</span>
        <span className="font-mono truncate">Finish {finishOf(card)}</span>
        <span className="font-mono">
          {card.inputThkMm}→{displayTarget} mm
          {card.finishThkMm != null && card.finishThkMm !== card.targetThkMm ? ` (fin ${card.finishThkMm})` : ''}
          {card.rollingPassNo && card.rollingPassNo > 1 ? ` · P${card.rollingPassNo}` : ''}
        </span>
        <span className="font-mono">{card.weightMt} MT</span>
        <span className="font-mono text-[10px] uppercase tracking-wide">Route {routeCode}</span>
        <span className="font-semibold text-foreground col-span-1 md:col-span-3">
          {card.machineAllocated === false
            ? `Unassigned${card.suggestedMachineCode ? ` · hint ${card.suggestedMachineCode}` : ''}`
            : `Mill ${card.machineCode}`}
        </span>
      </div>
    </button>
  );
});

function RowTitle({
  card,
  showCombineCheckbox,
  isInCombinedSelection,
  onCombineToggle,
}: Pick<SixHiQueueRowProps, 'card' | 'showCombineCheckbox' | 'isInCombinedSelection' | 'onCombineToggle'>) {
  return (
    <div className="min-w-0 flex items-start gap-2">
      {showCombineCheckbox && (
        <input
          type="checkbox"
          className="mt-1.5 h-4 w-4 shrink-0 accent-primary"
          checked={isInCombinedSelection}
          aria-label={`Include ${card.batchNumber} in combined start`}
          onClick={(e) => onCombineToggle(card.batchNumber, e)}
          onChange={() => undefined}
        />
      )}
      <div className="min-w-0">
        <span className="font-mono text-lg font-bold text-foreground block truncate">{displayMotherCoilId(card)}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Batch {card.batchNumber}
        </span>
      </div>
    </div>
  );
}
