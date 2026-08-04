import { Play } from 'lucide-react';
import { processQueueStatusLabel, type ProcessQueueCard } from '../../store/processStore';
import { ZButton } from '../primitives/ZButton';

interface ProcessQueueDetailPanelProps {
  card: ProcessQueueCard | null;
  processLabel: string;
  stationCode: string;
  onMoveToProduction: () => void;
  /** RWD combined start — overrides default CTA label. */
  moveLabel?: string;
  combinedCount?: number;
  combinedWeightMt?: number;
}

/** CRM-style detail pane — HRS fields + Move to Production CTA. */
export function ProcessQueueDetailPanel({
  card,
  processLabel: _processLabel,
  stationCode,
  onMoveToProduction,
  moveLabel,
  combinedCount = 0,
  combinedWeightMt,
}: ProcessQueueDetailPanelProps) {
  if (!card) {
    return (
      <div className="bg-white border border-border rounded-2xl p-6 h-full flex items-center justify-center text-muted-foreground text-base">
        Select a coil to view order details
      </div>
    );
  }

  const title = card.displayCoilNo ?? card.coilNo;
  const lines = card.orderLines ?? [];
  const fields: [string, string, boolean?][] = [
    ['Process Route', card.routeRaw?.trim() || '—', true],
    ['Station', stationCode],
    ['Customer', card.customerName || '—'],
    ['Grade', card.gradeCode || '—', true],
    ['Coil', title, true],
    ...(card.motherCoilNo ? [['Mother Coil', card.motherCoilNo, true] as [string, string, boolean?]] : []),
    ...(card.slitId ? [['Slit ID', card.slitId, true] as [string, string, boolean?]] : []),
    ...(card.batchNumber ? [['Batch Number', card.batchNumber, true] as [string, string, boolean?]] : []),
    ['Width', `${card.widthMm} mm`, true],
    ['Thickness', `${card.thicknessMm} mm`, true],
    ['Weight', `${card.weightMt} MT`, true],
    ...(card.combination ? [['Combination', card.combination, true] as [string, string, boolean?]] : []),
    ...(card.lineCount != null && card.lineCount > 1
      ? [['Lines', String(card.lineCount), true] as [string, string, boolean?]]
      : []),
  ];

  const canMove =
    card.status === 'PENDING'
    || card.status === 'PREPARING'
    || card.status === 'IN_PROGRESS'
    || card.status === 'STOPPAGE'
    || card.status === 'HOLD'
    || card.status === 'REJECTED';

  return (
    <div className="bg-white border border-border rounded-2xl h-full flex flex-col shadow-sm overflow-hidden">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Order Details</p>
        <h2 className="font-mono text-2xl font-bold text-foreground mt-1 truncate">{title}</h2>
        {(card.batchNumber || card.slitId) && (
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-1">
            {card.slitId ? `Slit ${card.slitId}` : null}
            {card.slitId && card.batchNumber ? ' · ' : null}
            {card.batchNumber ? `Batch ${card.batchNumber}` : null}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-3 flex-1 min-h-0 overflow-y-auto content-start">
        {fields.map(([k, v, mono]) => (
          <div key={k}>
            <dt className="text-muted-foreground text-[11px] uppercase tracking-wide leading-tight font-semibold">{k}</dt>
            <dd className={`font-bold mt-1 text-sm leading-snug text-foreground ${mono ? 'font-mono' : ''}`}>{v}</dd>
          </div>
        ))}
        {lines.length > 0 && (
          <div className="col-span-2 mt-1">
            <p className="text-muted-foreground text-[11px] uppercase tracking-wide font-semibold mb-2">Order lines</p>
            <ul className="space-y-1.5">
              {lines.map((line, i) => (
                <li key={`${line.batchNumber ?? i}-${line.widthMm ?? i}`} className="text-xs border border-border/60 rounded-lg px-3 py-2 font-mono">
                  {[
                    line.batchNumber,
                    line.widthMm != null ? `${line.widthMm} mm` : null,
                    line.weightMt != null ? `${line.weightMt} MT` : null,
                    line.customerName,
                    line.toWorkCenter,
                  ].filter(Boolean).join(' · ') || `Line ${i + 1}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </dl>

      <div className="shrink-0 mt-auto px-4 py-4 border-t border-border bg-secondary/30 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status</span>
          <span className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-warning/15 text-warning border border-warning/30">
            {processQueueStatusLabel(card.status)}
          </span>
        </div>
        {combinedCount > 1 && (
          <p className="text-sm font-medium tabular-nums text-center">
            Combined {combinedCount} · Σ {(combinedWeightMt ?? 0).toFixed(2)} MT
          </p>
        )}
        {canMove || (combinedCount > 1 && card.status === 'COMPLETED') ? (
          <ZButton type="button" className="w-full min-h-12" onClick={onMoveToProduction}>
            <Play className="h-4 w-4 mr-2" aria-hidden />
            {moveLabel ?? 'Move to Production…'}
          </ZButton>
        ) : (
          <p className="text-sm text-muted-foreground text-center">Completed — open from history if needed</p>
        )}
      </div>
    </div>
  );
}
