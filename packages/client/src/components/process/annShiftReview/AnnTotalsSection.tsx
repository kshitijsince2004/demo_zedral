import { AnnReviewCard } from './AnnReviewCard';
import { fmtMt } from './format';
import type { AnnShiftReviewPayload } from './types';

function MetricTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
      <div className="text-sm font-semibold text-foreground leading-snug">{children}</div>
    </div>
  );
}

export function AnnTotalsSection({
  production,
  dew,
  inProcess,
  cumulative,
}: {
  production: AnnShiftReviewPayload['production'];
  dew: AnnShiftReviewPayload['dew'];
  inProcess: AnnShiftReviewPayload['inProcess'];
  cumulative: AnnShiftReviewPayload['cumulative'];
}) {
  return (
    <AnnReviewCard title="Shift totals">
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricTile label="Shift production">
          Unload {fmtMt(production.unloadMt)} MT
          <span className="text-muted-foreground font-normal"> · </span>
          Load {fmtMt(production.loadMt)} MT
        </MetricTile>
        <MetricTile label="Dew">
          N₂ {dew.n2 ?? '—'}
          <span className="text-muted-foreground font-normal"> · </span>
          H₂ {dew.h2 ?? '—'}
        </MetricTile>
        <MetricTile label="In process">
          FOR_ANN {inProcess.forAnn}
          <span className="text-muted-foreground font-normal"> · </span>
          RW {inProcess.rw}
          <span className="text-muted-foreground font-normal"> · </span>
          IN_PROCESS {inProcess.inProcess}
          <span className="text-muted-foreground font-normal"> · </span>
          Total {inProcess.total}
        </MetricTile>
        <MetricTile label="Cumulative">
          Unload {fmtMt(cumulative.unloadMt)} MT
          <span className="text-muted-foreground font-normal"> · </span>
          Load {fmtMt(cumulative.loadMt)} MT
        </MetricTile>
      </div>
    </AnnReviewCard>
  );
}
