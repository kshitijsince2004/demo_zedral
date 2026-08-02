import { useEffect, useState } from 'react';
import { apiClient } from '../../../lib/apiClient';
import { bootstrapShiftContext } from '../../../lib/shiftDetection';
import { useShiftStore } from '../../../store/shiftStore';
import { AnnDelayRemarksSection } from './AnnDelayRemarksSection';
import { AnnProcessSection } from './AnnProcessSection';
import { AnnStoppageSection } from './AnnStoppageSection';
import { AnnTotalsSection } from './AnnTotalsSection';
import type { AnnShiftReviewPayload } from './types';

export type { AnnShiftReviewPayload } from './types';

/** Composes ANN review section cards — shared by handover + MH Shift Review. */
export function AnnShiftReviewStack({
  shiftLogId: shiftLogIdProp,
  className = '',
  remarks: remarksProp,
  onRemarksChange,
}: {
  shiftLogId?: string | null;
  className?: string;
  /** Controlled remarks (handover). When omitted, local editable state seeded from API. */
  remarks?: string;
  onRemarksChange?: (value: string) => void;
}) {
  const [review, setReview] = useState<AnnShiftReviewPayload | null>(null);
  const [logId, setLogId] = useState<string | null>(shiftLogIdProp ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [localRemarks, setLocalRemarks] = useState('');

  const controlled = remarksProp !== undefined;
  const remarks = controlled ? remarksProp : localRemarks;
  const setRemarks = onRemarksChange ?? setLocalRemarks;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let id = shiftLogIdProp ?? useShiftStore.getState().shiftLogId;
        if (!id) {
          await bootstrapShiftContext('ANN');
          id = useShiftStore.getState().shiftLogId;
        }
        if (!id) {
          const { shiftDate, shiftCode } = useShiftStore.getState();
          if (shiftDate && shiftCode) {
            const qs = `?date=${encodeURIComponent(shiftDate)}&shift=${encodeURIComponent(shiftCode)}`;
            const data = await apiClient.get<{ shiftLogId: string }>(`/shift-logs/active/ANN${qs}`);
            id = data.shiftLogId;
            if (id) useShiftStore.setState({ shiftLogId: id });
          }
        }
        if (!id || cancelled) {
          if (!cancelled) {
            setReview(null);
            setLogId(null);
            setError(null);
          }
          return;
        }
        setLogId(id);
        const data = await apiClient.get<AnnShiftReviewPayload>(
          `/stations/ann/shift-review?shiftLogId=${encodeURIComponent(id)}`,
        );
        if (!cancelled) {
          setReview(data);
          setError(null);
          if (!controlled) setLocalRemarks(data.remarks ?? '');
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load ANN review');
          setReview(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [shiftLogIdProp, controlled]);

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          ANN shift review
        </p>
        <p className="text-[10px] text-muted-foreground font-mono">
          {logId ? `log ${logId}` : 'No active ANN shift'}
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground px-0.5">Loading review…</p>}
      {error && <p className="text-sm text-destructive px-0.5">{error}</p>}
      {!loading && !error && !review && (
        <p className="text-sm text-muted-foreground px-0.5">No ANN review data for this shift.</p>
      )}

      {review && (
        <>
          <AnnProcessSection rows={review.process} />
          <AnnStoppageSection rows={review.stoppages} />
          <AnnDelayRemarksSection
            delaySummary={review.delaySummary}
            totalDelayMin={review.totalDelayMin}
            crew={review.crew}
            remarks={remarks}
            onRemarksChange={setRemarks}
          />
          <AnnTotalsSection
            production={review.production}
            dew={review.dew}
            inProcess={review.inProcess}
            cumulative={review.cumulative}
          />
        </>
      )}
    </div>
  );
}
