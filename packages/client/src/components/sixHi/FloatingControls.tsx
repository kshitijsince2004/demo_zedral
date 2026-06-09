import { AlertTriangle, MessageSquare, Play, Square } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';
import type { SixHiOrderStatus } from '@m1/shared-validation';

interface FloatingControlsProps {
  status: SixHiOrderStatus;
  hasActiveStoppage: boolean;
  onStart: () => void;
  onEnd: () => void;
  onStoppage: () => void;
  onRemark: () => void;
  busy?: boolean;
}

export function FloatingControls({
  status,
  hasActiveStoppage,
  onStart,
  onEnd,
  onStoppage,
  onRemark,
  busy,
}: FloatingControlsProps) {
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none"
      aria-label="Production controls"
    >
      <div className="pointer-events-auto flex flex-col gap-2 shadow-lg rounded-sm p-2 bg-card/95 border border-border backdrop-blur-sm">
        {(status === 'PENDING' || status === 'STOPPAGE') && !hasActiveStoppage && (
          <ZButton variant="accent" size="lg" onClick={onStart} disabled={busy} className="min-w-[160px]">
            <Play className="h-5 w-5" aria-hidden />
            Start Production
          </ZButton>
        )}
        {(status === 'IN_PROGRESS' || (status === 'STOPPAGE' && !hasActiveStoppage)) && (
          <ZButton variant="danger" size="lg" onClick={onEnd} disabled={busy} className="min-w-[160px]">
            <Square className="h-5 w-5" aria-hidden />
            End Production
          </ZButton>
        )}
        <ZButton
          variant="secondary"
          size="lg"
          onClick={onStoppage}
          disabled={busy}
          className="min-w-[160px] border-warning/50 text-warning"
        >
          <AlertTriangle className="h-5 w-5" aria-hidden />
          {hasActiveStoppage ? 'End Stoppage' : 'Stoppage'}
        </ZButton>
        <ZButton variant="ghost" size="md" onClick={onRemark} disabled={busy} className="min-w-[160px]">
          <MessageSquare className="h-4 w-4" aria-hidden />
          Remark
        </ZButton>
      </div>
    </div>
  );
}
