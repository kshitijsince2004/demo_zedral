import type { MouseEvent } from 'react';
import { processQueueStatusLabel, type ProcessQueueCard } from '../../store/processStore';

const STATUS_TONE: Record<ProcessQueueCard['status'], string> = {
  PENDING: 'bg-warning/15 text-warning border-warning/30',
  PREPARING: 'bg-primary/10 text-primary border-primary/30',
  IN_PROGRESS: 'bg-primary/10 text-primary border-primary/30',
  STOPPAGE: 'bg-warning/15 text-warning border-warning/30',
  HOLD: 'bg-destructive/10 text-destructive border-destructive/30',
  REJECTED: 'bg-destructive/10 text-destructive border-destructive/30',
  COMPLETED: 'bg-secondary text-muted-foreground border-border',
};

interface ProcessQueueRowProps {
  card: ProcessQueueCard;
  selected: boolean;
  processLabel: string;
  onSelect: () => void;
  onOpen: () => void;
  /** RWD combine — show checkbox when compatible pool has ≥2. */
  showCombineCheckbox?: boolean;
  isInCombinedSelection?: boolean;
  combinedSelectionCount?: number;
  onCombineToggle?: (batchNumber: string, event: MouseEvent) => void;
}

/** CRM-density queue row for process hubs (HRS Skin Pass–style list). */
export function ProcessQueueRow({
  card,
  selected,
  processLabel,
  onSelect,
  onOpen,
  showCombineCheckbox,
  isInCombinedSelection,
  combinedSelectionCount = 0,
  onCombineToggle,
}: ProcessQueueRowProps) {
  const title = card.displayCoilNo ?? card.coilNo;
  const batch = card.batchNumber;
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={[
        'w-full text-left rounded-xl border px-4 py-3 transition-colors',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
          : 'border-border bg-white hover:border-primary/30 hover:bg-secondary/20',
        isInCombinedSelection && combinedSelectionCount > 1 ? 'ring-1 ring-success/25' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2">
          {showCombineCheckbox && batch && onCombineToggle && (
            <input
              type="checkbox"
              className="mt-1.5 h-4 w-4 shrink-0 accent-primary"
              checked={!!isInCombinedSelection}
              aria-label={`Include ${batch} in combined start`}
              onClick={(e) => onCombineToggle(batch, e)}
              onChange={() => undefined}
            />
          )}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">
              {card.customerName || '—'}
              <span className="mx-1.5">·</span>
              {processLabel}
            </p>
            <p className="font-mono text-base font-bold text-foreground mt-0.5 truncate">{title}</p>
            {(card.batchNumber || card.slitId || card.motherCoilNo) && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {card.motherCoilNo ? `Mother ${card.motherCoilNo}` : null}
                {card.motherCoilNo && (card.slitId || card.batchNumber) ? ' · ' : null}
                {card.slitId ? `Slit ${card.slitId}` : null}
                {card.slitId && card.batchNumber ? ' · ' : null}
                {card.batchNumber ? `Batch ${card.batchNumber}` : null}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {isInCombinedSelection && combinedSelectionCount > 1 && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-success/15 text-success">
              Combined
            </span>
          )}
          <span className={[
            'text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border',
            STATUS_TONE[card.status],
          ].join(' ')}>
            {processQueueStatusLabel(card.status)}
          </span>
        </div>
      </div>
      <p className="text-xs mt-2 text-foreground/90">
        {card.gradeCode || '—'}
        {card.combination ? ` · ${card.combination}` : ''}
        {card.lineCount != null && card.lineCount > 1 ? ` · ${card.lineCount} lines` : ''}
        {' · '}
        {card.widthMm} mm · {card.thicknessMm} mm · {card.weightMt} MT
      </p>
    </button>
  );
}
