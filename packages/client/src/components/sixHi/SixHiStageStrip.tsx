import { ChevronRight } from 'lucide-react';

export interface StageCount {
  id: string;
  label: string;
  count: number;
  color: string;
}

interface SixHiStageStripProps {
  stages: StageCount[];
  recalcSeconds?: number;
}

export function SixHiStageStrip({ stages, recalcSeconds = 142 }: SixHiStageStripProps) {
  const mins = Math.floor(recalcSeconds / 60);
  const secs = String(recalcSeconds % 60).padStart(2, '0');

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap flex-1">
        {stages.map((stage, idx) => (
          <div key={stage.id} className="flex items-center gap-2">
            <div className="bg-white border border-border rounded-xl px-4 py-3 min-w-[100px] shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: stage.color }}>
                {stage.label}
              </div>
              <div className="text-2xl font-semibold text-foreground mt-0.5">{stage.count}</div>
            </div>
            {idx < stages.length - 1 && (
              <ChevronRight className="h-4 w-4 text-[#C5CECA] shrink-0 hidden sm:block" aria-hidden />
            )}
          </div>
        ))}
      </div>
      <div className="text-sm text-muted-foreground shrink-0">
        Next recalc in{' '}
        <span className="font-mono font-semibold text-[#F1B824]">
          {mins}:{secs}
        </span>
      </div>
    </div>
  );
}
