import { MoreVertical } from 'lucide-react';

export type AnnBoardCardStatus = 'RUNNING' | 'WARNING' | 'COMPLETE' | 'IDLE';

export type AnnBoardRow = {
  base_no: string;
  charge: {
    charge_no: string;
    annealing_batch_no: string | null;
    status: string;
    current_stage_code: string | null;
    no_of_coils: number | null;
    soak_temp_degc: number | string | null;
  } | null;
  stages_done: number;
  stages_total: number;
  active_stage_start_at: string | null;
  latest_reading: {
    taken_at: string;
    charge_temp: number | string | null;
    base_press: number | string | null;
    base_fan_rpm: number | string | null;
  } | null;
  has_open_stoppage: boolean;
};

const STATUS_STRIP: Record<AnnBoardCardStatus, string> = {
  RUNNING: 'bg-status-running text-primary-foreground',
  WARNING: 'bg-status-stopped text-primary-foreground',
  COMPLETE: 'bg-status-setup text-primary-foreground',
  IDLE: 'bg-status-idle text-primary-foreground',
};

const PROGRESS_FILL: Record<AnnBoardCardStatus, string> = {
  RUNNING: 'bg-status-running',
  WARNING: 'bg-status-stopped',
  COMPLETE: 'bg-status-setup',
  IDLE: 'bg-status-idle',
};

export function boardCardStatus(row: AnnBoardRow): AnnBoardCardStatus {
  if (!row.charge) return 'IDLE';
  if (row.charge.status === 'DONE') return 'COMPLETE';
  if (row.charge.status === 'PREPARING') return 'IDLE';
  if (row.has_open_stoppage) return 'WARNING';
  return 'RUNNING';
}

function humanizeStage(code: string | null | undefined) {
  if (!code) return '—';
  return code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function readingAge(iso: string | undefined) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function stageElapsed(iso: string | null) {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}H ${String(m).padStart(2, '0')}M` : `${m}M`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">{label}</span>
      <span className="text-[12px] font-bold font-mono tabular-nums text-foreground truncate">{value}</span>
    </div>
  );
}

/** Compact landscape base card. */
export function AnnBaseCard({
  row,
  onOpen,
  onOpenBase,
}: {
  row: AnnBoardRow;
  onOpen?: (chargeNo: string) => void;
  onOpenBase?: (baseNo: string) => void;
}) {
  const status = boardCardStatus(row);
  const total = Math.max(1, row.stages_total || 10);
  const pct = status === 'IDLE' ? 0 : Math.round((row.stages_done / total) * 100);
  const elapsed = stageElapsed(row.active_stage_start_at);
  const hasCharge = Boolean(row.charge?.charge_no);
  const setpoint = row.charge?.soak_temp_degc != null ? Number(row.charge.soak_temp_degc) : null;
  const tempVal =
    row.latest_reading?.charge_temp != null
      ? `${row.latest_reading.charge_temp}${setpoint != null ? ` / ${setpoint}` : ''}`
      : setpoint != null
        ? `— / ${setpoint}`
        : '—';
  const progressCaption = status === 'RUNNING' ? (elapsed ?? 'RUNNING') : status === 'WARNING' ? 'STOPPAGE' : status;

  return (
    <article
      className={[
        'flex overflow-hidden rounded-lg border border-border bg-background text-left shadow-sm',
        'transition-[box-shadow,transform] duration-150 min-h-[5.5rem]',
        'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      ].join(' ')}
      onClick={() => {
        if (hasCharge && onOpen) {
          onOpen(row.charge!.charge_no);
        } else if (!hasCharge && onOpenBase) {
          onOpenBase(row.base_no);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (hasCharge && onOpen) onOpen(row.charge!.charge_no);
          else if (!hasCharge && onOpenBase) onOpenBase(row.base_no);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div
        className={`w-8 shrink-0 flex items-center justify-center ${STATUS_STRIP[status]}`}
        aria-label={status === 'WARNING' ? 'STOPPAGE' : status}
      >
        <span className="text-[9px] font-bold uppercase tracking-widest [writing-mode:vertical-rl] rotate-180">
          {status === 'WARNING' ? 'STOPPAGE' : status}
        </span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-2 px-3 py-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 grid grid-cols-3 gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Base</p>
              <p className="text-[13px] font-bold font-mono tabular-nums text-foreground truncate">{row.base_no}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Ann batch no.</p>
              <p className="text-[13px] font-bold font-mono tabular-nums text-foreground truncate">
                {row.charge?.annealing_batch_no?.trim() ? row.charge.annealing_batch_no : '—'}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Stage</p>
              <p className="text-[13px] font-bold text-foreground truncate">
                {humanizeStage(row.charge?.current_stage_code)}
              </p>
            </div>
          </div>

          <div className="w-[9.5rem] shrink-0 space-y-1">
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground truncate">
                {progressCaption}
              </span>
              <span className="text-sm font-bold font-mono tabular-nums text-foreground">{pct}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${PROGRESS_FILL[status]}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            className="min-h-10 min-w-10 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-card shrink-0"
            aria-label="Base options"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        {/* Metrics: two lines × three columns */}
        <div className="flex items-end gap-3 border-t border-border pt-1.5">
          <div className="flex-1 min-w-0 grid grid-cols-3 gap-x-4 gap-y-1">
            <Metric label="Temp / SP" value={tempVal} />
            <Metric label="Pressure" value={String(row.latest_reading?.base_press ?? '—')} />
            <Metric label="RPM" value={String(row.latest_reading?.base_fan_rpm ?? '—')} />
            <Metric label="Last" value={readingAge(row.latest_reading?.taken_at)} />
            <Metric label="Operator" value="—" />
            <Metric label="Orders" value={String(row.charge?.no_of_coils ?? 0)} />
          </div>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground whitespace-nowrap">Base details</span>
        </div>
      </div>
    </article>
  );
}
