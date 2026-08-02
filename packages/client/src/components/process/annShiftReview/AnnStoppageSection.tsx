import { AnnReviewCard } from './AnnReviewCard';
import { fmtDur } from './format';
import type { AnnShiftReviewPayload } from './types';

export function AnnStoppageSection({ rows }: { rows: AnnShiftReviewPayload['stoppages'] }) {
  return (
    <AnnReviewCard title="Stoppage details">
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full min-w-[32rem] text-xs">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="pb-2 pr-3 font-semibold">Charge</th>
              <th className="pb-2 pr-3 font-semibold">Category</th>
              <th className="pb-2 pr-3 font-semibold">Reason / details</th>
              <th className="pb-2 font-semibold">Duration (min)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="py-4 text-muted-foreground" colSpan={4}>No stoppages.</td>
              </tr>
            )}
            {rows.map((s, i) => (
              <tr key={`${s.charge_no}-${i}`} className="border-t border-border/60">
                <td className="py-2.5 pr-3 font-mono font-semibold">{s.charge_no}</td>
                <td className="py-2.5 pr-3">{s.category_label ?? s.category_code}</td>
                <td className="py-2.5 pr-3">{[s.reason, s.remark].filter(Boolean).join(' — ') || '—'}</td>
                <td className="py-2.5 tabular-nums">{fmtDur(s.duration_min)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnnReviewCard>
  );
}
