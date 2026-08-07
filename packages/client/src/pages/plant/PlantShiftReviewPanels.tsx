// PERF-B3 � review panels extracted from PlantShiftReviewPage
import { useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { formatShiftDate } from '../../lib/dateFormat';
import { ZButton } from '../../components/primitives/ZButton';
import { VirtualizedList } from '../../components/VirtualizedList';
import { CompletedOrderRow, InProgressOrderRow, StoppageReviewRow, formatMinutes } from './PlantShiftReviewRows';

const VIRTUALIZE_THRESHOLD = 20;
export interface ShiftLogRow {
  id: string;
  shiftDate: string;
  shiftCode: string;
  processLine: string;
  submittedBy: string;
  submittedAt: string;
  state: string;
  entryCount: number;
  overrideCount: number;
  millType?: string | null;
  /** Canonical machine for this card (server: one machine � one shift � one card). */
  machine?: string;
  machines?: string[];
  /** When set, this row is a per-machine view of a shared shift log. */
  reviewMachine?: string;
}

export interface ShiftReviewData {
  shiftLogId: string;
  prodDate: string;
  shiftCode: string;
  processLine?: string;
  millType?: string | null;
  state: string;
  machines: string[];
  overview: {
    targetMt: number;
    completedProdMt: number;
    totalProdMt: number;
    inProgressProdMt: number;
    attainmentPct: number;
  };
  metrics: {
    totalStoppageMinutes: number;
    totalBreakdownMinutes: number;
    machineUtilizationPct: number;
    shiftCapacityMinutes: number;
  };
  completedOrders: { batchNumber: string; subProcess?: string; customer?: string; weightMt: number; durationMin?: number }[];
  completedOrdersNextCursor?: string | null;
  ordersInProgress: { batchNumber: string; status: string; subProcess?: string; machineCode?: string }[];
  stoppages: { id: string; batchNumber: string; categoryLabel: string; startAt: string; endAt?: string; durationMin?: number; remarks?: string }[];
  crew?: { id: string; crewId: string; operatorName: string; roleCode: string }[];
  crewMissing?: boolean;
  autoClosed?: boolean;
  readings?: {
    scrapKg: number | null;
    coolantTempDegC: number | null;
    coolantPressKgCm2: number | null;
  };
  readingsMissing?: {
    scrapKg: boolean;
    coolantTempDegC: boolean;
    coolantPressKgCm2: boolean;
  };
  autoHandover?: {
    handoverId: string;
    remarks: string;
    machineCode: string;
    pendingReview: boolean;
    reviewState?: string;
  } | null;
}

/** In-progress / open shift logs (operators still writing). */
export const ACTIVE_STATES = new Set(['DRAFT', 'REOPENED']);
/** Submitted archive (Task 4 completed definition). */
export const COMPLETED_STATES = new Set(['SUBMITTED', 'APPROVED']);
export const VISIBLE_STATES = new Set([...ACTIVE_STATES, ...COMPLETED_STATES]);

export const SHIFT_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

export type StatusFilter = 'ALL' | 'ACTIVE' | 'COMPLETED';

export function isActiveState(state: string): boolean {
  return ACTIVE_STATES.has(state);
}

export function ReviewMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-bold font-mono tabular-nums text-foreground mt-0.5">{value}</div>
    </div>
  );
}

export function StateBadge({ state }: { state: string }) {
  const active = isActiveState(state);
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg ${
        active
          ? 'text-amber-800 bg-amber-500/15'
          : 'text-success bg-success/10'
      }`}
    >
      {active ? `Active · ${state}` : state}
    </span>
  );
}

export function ShiftCompleteForm({
  shiftLogId,
  review,
  onCompleted,
}: {
  shiftLogId: string;
  review?: ShiftReviewData;
  onCompleted: () => void;
}) {
  const autoPending = !!(review?.autoClosed && review.autoHandover?.pendingReview);
  const [remarks, setRemarks] = useState(review?.autoHandover?.remarks ?? '');
  const [scrapKg, setScrapKg] = useState(
    review?.readings?.scrapKg != null ? String(review.readings.scrapKg) : '',
  );
  const [coolantTemp, setCoolantTemp] = useState(
    review?.readings?.coolantTempDegC != null ? String(review.readings.coolantTempDegC) : '',
  );
  const [coolantPress, setCoolantPress] = useState(
    review?.readings?.coolantPressKgCm2 != null ? String(review.readings.coolantPressKgCm2) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async () => {
    const trimmed = remarks.trim();
    if (!trimmed) {
      setError('Remarks are required to mark this shift completed.');
      return;
    }
    const confirmed = window.confirm(
      autoPending
        ? 'Sign off this auto-closed shift? Empty coolant/scrap fields will be saved first, then the shift moves to the completed archive.'
        : 'Mark this shift as completed? It will move to the completed archive for this production day.',
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      if (autoPending) {
        await apiClient.patch(`/shift-logs/${shiftLogId}/manual-fields`, {
          scrapKg: scrapKg.trim() === '' ? null : Number(scrapKg),
          coolantTempDegC: coolantTemp.trim() === '' ? null : Number(coolantTemp),
          coolantPressKgCm2: coolantPress.trim() === '' ? null : Number(coolantPress),
          remarks: trimmed,
        });
      }
      await putQueued(`/shift-logs/${shiftLogId}/complete`, { remarks: trimmed }, `shift-log:${shiftLogId}`);
      onCompleted();
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to complete shift');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-border/60 space-y-3">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {autoPending ? 'MH sign-off (auto-closed shift)' : 'Mark shift completed'}
      </h4>
      <p className="text-xs text-muted-foreground">
        {autoPending
          ? 'Backfill any missing coolant/scrap readings from paper notes, then sign off to clear the MH action item.'
          : 'Closes this active shift log (DRAFT → SUBMITTED). Add closure notes for the archive.'}
      </p>
      {autoPending && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="text-xs space-y-1">
            <span className="font-semibold text-muted-foreground uppercase">Coolant °C</span>
            <input
              type="number"
              step="any"
              value={coolantTemp}
              onChange={(e) => setCoolantTemp(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                review?.readingsMissing?.coolantTempDegC ? 'border-warning' : 'border-border'
              } bg-white`}
              placeholder="Missing"
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="font-semibold text-muted-foreground uppercase">Coolant Kg/cm²</span>
            <input
              type="number"
              step="any"
              value={coolantPress}
              onChange={(e) => setCoolantPress(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                review?.readingsMissing?.coolantPressKgCm2 ? 'border-warning' : 'border-border'
              } bg-white`}
              placeholder="Missing"
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="font-semibold text-muted-foreground uppercase">Scrap Kg</span>
            <input
              type="number"
              step="any"
              value={scrapKg}
              onChange={(e) => setScrapKg(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                review?.readingsMissing?.scrapKg ? 'border-warning' : 'border-border'
              } bg-white`}
              placeholder="Missing"
            />
          </label>
        </div>
      )}
      <textarea
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Shift closure remarks (handover notes, open items, production summary…)"
        rows={3}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-y min-h-[4.5rem]"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ZButton variant="accent" onClick={() => void handleComplete()} disabled={busy}>
        {busy ? 'Saving…' : autoPending ? 'Sign off & complete' : 'Mark completed'}
      </ZButton>
    </div>
  );
}

export function ShiftReviewPanel({
  review,
  onLoadMoreCompleted,
}: {
  review: ShiftReviewData;
  onLoadMoreCompleted?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {(review.autoClosed || review.crewMissing) && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs space-y-1">
          {review.autoClosed && (
            <p className="font-semibold text-warning-foreground">
              Auto-closed — no operator handover
              {review.autoHandover?.pendingReview ? ' · awaiting MH sign-off' : ''}
            </p>
          )}
          {review.autoHandover?.remarks && (
            <p className="text-muted-foreground">{review.autoHandover.remarks}</p>
          )}
          {review.crewMissing && (
            <p className="text-muted-foreground">Crew not recorded for this shift.</p>
          )}
          {review.autoClosed && review.readingsMissing && (
            <p className="text-muted-foreground">
              Missing readings:
              {[
                review.readingsMissing.coolantTempDegC ? ' coolant °C' : null,
                review.readingsMissing.coolantPressKgCm2 ? ' coolant pressure' : null,
                review.readingsMissing.scrapKg ? ' scrap kg' : null,
              ]
                .filter(Boolean)
                .join(',') || ' none'}
              . Backfill on sign-off.
            </p>
          )}
        </div>
      )}

      {(review.readings || review.autoClosed) && (
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Shift readings
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <ReviewMetric
              label="Coolant °C"
              value={review.readings?.coolantTempDegC ?? '—'}
            />
            <ReviewMetric
              label="Coolant Kg/cm²"
              value={review.readings?.coolantPressKgCm2 ?? '—'}
            />
            <ReviewMetric label="Scrap Kg" value={review.readings?.scrapKg ?? '—'} />
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Shift Overview</h4>
        <p className="text-xs text-muted-foreground mb-2">
          {formatShiftDate(review.prodDate)} · Shift {review.shiftCode}
          {review.machines.length === 1
            ? ` · ${review.machines[0]}`
            : review.millType
              ? ` · ${review.millType}`
              : review.processLine
                ? ` · ${review.processLine}`
                : ''}
          {review.machines.length > 1 ? ` · ${review.machines.join(', ')}` : ''}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <ReviewMetric label="Target MT" value={review.overview.targetMt} />
          <ReviewMetric label="Completed MT" value={review.overview.completedProdMt} />
          <ReviewMetric label="Total MT" value={review.overview.totalProdMt} />
          <ReviewMetric label="In Progress MT" value={review.overview.inProgressProdMt} />
          <ReviewMetric label="Attainment" value={`${review.overview.attainmentPct}%`} />
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Crew this shift ({review.crew?.length ?? 0})
        </h4>
        {review.crew && review.crew.length > 0 ? (
          <ul className="divide-y divide-border/60 text-xs rounded-lg border border-border/60 overflow-hidden">
            {review.crew.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 px-3 py-2 bg-white/40">
                <span className="font-semibold">{c.operatorName}</span>
                <span className="text-muted-foreground uppercase">{c.roleCode}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No crew recorded.</p>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Downtime & Utilization</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <ReviewMetric label="Stoppage" value={formatMinutes(review.metrics.totalStoppageMinutes)} />
          <ReviewMetric label="Breakdown" value={formatMinutes(review.metrics.totalBreakdownMinutes)} />
          <ReviewMetric label="Utilization" value={`${review.metrics.machineUtilizationPct}%`} />
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Completed Orders ({review.completedOrders.length})
        </h4>
        {review.completedOrders.length > 0 ? (
          review.completedOrders.length > VIRTUALIZE_THRESHOLD ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <VirtualizedList
                items={review.completedOrders}
                estimateSize={36}
                className="max-h-64"
                getKey={(o) => o.batchNumber}
                renderItem={(o) => (
                  <ul className="divide-y divide-border/60 text-xs">
                    <CompletedOrderRow o={o} />
                  </ul>
                )}
                onNearEnd={review.completedOrdersNextCursor ? onLoadMoreCompleted : undefined}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/60 text-xs rounded-lg border border-border/60 overflow-hidden">
              {review.completedOrders.map((o) => (
                <CompletedOrderRow key={o.batchNumber} o={o} />
              ))}
            </ul>
          )
        ) : (
          <p className="text-xs text-muted-foreground">No completed orders.</p>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Orders In Progress ({review.ordersInProgress.length})
        </h4>
        {review.ordersInProgress.length > 0 ? (
          review.ordersInProgress.length > VIRTUALIZE_THRESHOLD ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <VirtualizedList
                items={review.ordersInProgress}
                estimateSize={36}
                className="max-h-64"
                getKey={(o) => o.batchNumber}
                renderItem={(o) => (
                  <ul className="divide-y divide-border/60 text-xs">
                    <InProgressOrderRow o={o} />
                  </ul>
                )}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/60 text-xs rounded-lg border border-border/60 overflow-hidden">
              {review.ordersInProgress.map((o) => (
                <InProgressOrderRow key={o.batchNumber} o={o} />
              ))}
            </ul>
          )
        ) : (
          <p className="text-xs text-muted-foreground">No orders in progress.</p>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Stoppages ({review.stoppages.length})
        </h4>
        {review.stoppages.length > 0 ? (
          <ul className="divide-y divide-border/60 text-xs rounded-lg border border-border/60 overflow-hidden">
            {review.stoppages.map((s) => (
              <StoppageReviewRow key={s.id} s={s} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No stoppages recorded.</p>
        )}
      </div>
    </div>
  );
}

