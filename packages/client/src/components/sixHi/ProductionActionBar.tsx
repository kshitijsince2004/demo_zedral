import { AlertTriangle, MessageSquare, Play, Square } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';
import type { SixHiOrderStatus } from '@m1/shared-validation';

interface ProductionActionBarProps {
  status: SixHiOrderStatus;
  hasActiveStoppage: boolean;
  onStart: () => void;
  onEnd: () => void;
  onStoppage: () => void;
  onRemark: () => void;
  busy?: boolean;
}

export function ProductionActionBar({
  status,
  hasActiveStoppage,
  onStart,
  onEnd,
  onStoppage,
  onRemark,
  busy,
}: ProductionActionBarProps) {
  const canStart = (status === 'PENDING' || status === 'PREPARING' || status === 'STOPPAGE') && !hasActiveStoppage;
  const canEnd = status === 'IN_PROGRESS' || (status === 'STOPPAGE' && !hasActiveStoppage);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-white/95 backdrop-blur-sm px-4 py-3 safe-area-pb"
      aria-label="Production controls"
    >
      <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-2">
        {canStart && (
          <ZButton variant="accent" size="lg" onClick={onStart} disabled={busy} fullWidth className="min-h-14">
            <Play className="h-5 w-5" aria-hidden />
            Start
          </ZButton>
        )}
        {canEnd && (
          <ZButton variant="danger" size="lg" onClick={onEnd} disabled={busy} fullWidth className="min-h-14">
            <Square className="h-5 w-5" aria-hidden />
            End
          </ZButton>
        )}
        <ZButton
          variant="secondary"
          size="lg"
          onClick={onStoppage}
          disabled={busy}
          fullWidth
          className="min-h-14 border-warning/50 text-warning"
        >
          <AlertTriangle className="h-5 w-5" aria-hidden />
          {hasActiveStoppage ? 'End Stop' : 'Stoppage'}
        </ZButton>
        <ZButton variant="ghost" size="lg" onClick={onRemark} disabled={busy} fullWidth className="min-h-14">
          <MessageSquare className="h-5 w-5" aria-hidden />
          Remark
        </ZButton>
      </div>
    </div>
  );
}
