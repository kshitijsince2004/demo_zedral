import { AnnReviewCard } from './AnnReviewCard';
import { fmtDur } from './format';
import type { AnnShiftReviewPayload } from './types';

export function AnnDelayRemarksSection({
  delaySummary,
  totalDelayMin,
  crew,
  remarks,
  onRemarksChange,
}: {
  delaySummary: AnnShiftReviewPayload['delaySummary'];
  totalDelayMin?: number;
  crew?: AnnShiftReviewPayload['crew'];
  remarks: string;
  onRemarksChange?: (value: string) => void;
}) {
  const editable = typeof onRemarksChange === 'function';
  const total = totalDelayMin ?? delaySummary.reduce((a, d) => a + Number(d.minutes || 0), 0);

  return (
    <AnnReviewCard title="Remarks & delay summary">
      <div className="overflow-x-auto -mx-1 px-1 mb-4">
        <table className="w-full text-xs">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="pb-2 pr-3 font-semibold">Class</th>
              <th className="pb-2 font-semibold">Minutes</th>
            </tr>
          </thead>
          <tbody>
            {delaySummary.map((d) => (
              <tr key={d.bucket} className="border-t border-border/60">
                <td className="py-2.5 pr-3">{d.bucket}</td>
                <td className="py-2.5 tabular-nums">{fmtDur(d.minutes)}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-bold">
              <td className="py-2.5 pr-3">Total Delay</td>
              <td className="py-2.5 tabular-nums">{fmtDur(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {crew && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 text-xs">
          {(
            [
              ['OPERATOR / ENGINEER', crew.operatorEngineer],
              ['HELPER', crew.helper],
              ['CRANE OPERATOR', crew.craneOperator],
              ['SHIFT INCHARGE', crew.shiftIncharge],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className="mt-0.5 font-semibold text-foreground">{value || '—'}</p>
            </div>
          ))}
        </div>
      )}

      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Remarks</span>
        <textarea
          className="mt-1.5 w-full min-h-[5.5rem] rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-70"
          value={remarks}
          onChange={(e) => onRemarksChange?.(e.target.value)}
          readOnly={!editable}
          placeholder={editable ? 'Shift remarks for incoming crew…' : undefined}
          rows={4}
          aria-label="Remarks"
        />
      </label>
    </AnnReviewCard>
  );
}
