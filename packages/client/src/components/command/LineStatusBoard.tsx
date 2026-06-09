import { CirclePause, CirclePlay, Wrench } from 'lucide-react';
import type { LineShiftStatus } from '../../lib/reportingService';
import { ZBadge } from '../primitives/ZBadge';
import type { Tone } from '../../lib/tones';

function statusTone(status: LineShiftStatus['status']): Tone {
  switch (status) {
    case 'RUNNING':
      return 'success';
    case 'IDLE':
      return 'muted';
    case 'STOPPED':
      return 'warning';
    case 'MAINTENANCE':
      return 'info';
    default:
      return 'muted';
  }
}
function StatusIcon({ status }: { status: LineShiftStatus['status'] }) {
  if (status === 'RUNNING') return <CirclePlay className="h-4 w-4" aria-hidden />;
  if (status === 'MAINTENANCE') return <Wrench className="h-4 w-4" aria-hidden />;
  return <CirclePause className="h-4 w-4" aria-hidden />;
}

interface LineStatusBoardProps {
  lines: LineShiftStatus[];
}

export function LineStatusBoard({ lines }: LineStatusBoardProps) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-2xl bg-background">
        No lines in scope
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
      {lines.map((line) => (
        <div
          key={line.lineId}
          className="border border-border rounded-2xl bg-background shadow-sm p-3 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-base font-bold text-primary">{line.lineId}</span>
            <ZBadge tone={statusTone(line.status)} label={line.status} />
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{line.lineName}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto pt-1 border-t border-border/60">
            <StatusIcon status={line.status} />
            <span>Shift {line.shiftCode}</span>
            <span className="truncate ml-auto">{line.operatorName ?? '—'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
