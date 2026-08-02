import { formatPlantDateTime } from '../../../lib/dateFormat';
import { AnnReviewCard } from './AnnReviewCard';
import { fmtMt } from './format';
import type { AnnShiftReviewPayload } from './types';

export function AnnProcessSection({ rows }: { rows: AnnShiftReviewPayload['process'] }) {
  return (
    <AnnReviewCard title="Process">
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full min-w-[48rem] text-xs">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="pb-2 pr-3 font-semibold">Base</th>
              <th className="pb-2 pr-3 font-semibold">Charge / Batch</th>
              <th className="pb-2 pr-3 font-semibold">Grade</th>
              <th className="pb-2 pr-3 font-semibold">#coils</th>
              <th className="pb-2 pr-3 font-semibold">Charge wt</th>
              <th className="pb-2 pr-3 font-semibold">Status</th>
              <th className="pb-2 pr-3 font-semibold">Exp unload</th>
              <th className="pb-2 pr-3 font-semibold">Unload wt</th>
              <th className="pb-2 pr-3 font-semibold">Temp</th>
              <th className="pb-2 font-semibold">F/C No</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="py-4 text-muted-foreground" colSpan={10}>No charges this shift.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.charge_no} className="border-t border-border/60">
                <td className="py-2.5 pr-3 font-mono font-semibold">{r.base_no ?? '—'}</td>
                <td className="py-2.5 pr-3 font-mono">
                  {r.charge_no}{r.annealing_batch_no ? ` / ${r.annealing_batch_no}` : ''}
                </td>
                <td className="py-2.5 pr-3">{r.grade_code ?? '—'}</td>
                <td className="py-2.5 pr-3 tabular-nums">{r.no_of_coils ?? '—'}</td>
                <td className="py-2.5 pr-3 tabular-nums">{fmtMt(r.charge_wt_mt)}</td>
                <td className="py-2.5 pr-3">{r.status ?? '—'}</td>
                <td className="py-2.5 pr-3">{r.exp_unloading_time ? formatPlantDateTime(r.exp_unloading_time) : '—'}</td>
                <td className="py-2.5 pr-3 tabular-nums">{fmtMt(r.unloading_wt_mt)}</td>
                <td className="py-2.5 pr-3 tabular-nums">{r.temp != null ? Number(r.temp).toFixed(0) : '—'}</td>
                <td className="py-2.5 tabular-nums">{r.furnace_id ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnnReviewCard>
  );
}
