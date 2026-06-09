import { Check, Circle, RefreshCw, X } from 'lucide-react';
import type { ProcessRouteStepView } from '@m1/shared-validation';

interface ProcessRouteTimelineProps {
  steps: ProcessRouteStepView[];
  compact?: boolean;
  direction?: 'vertical' | 'horizontal';
}

function stepColor(status: ProcessRouteStepView['status'], isReroll?: boolean): string {
  if (isReroll) {
    switch (status) {
      case 'COMPLETED':
        return 'border-orange-500/40 bg-orange-500/10 text-orange-600';
      case 'ACTIVE':
        return 'border-orange-500/50 bg-orange-500/15 text-orange-600';
      default:
        return 'border-orange-400/30 bg-orange-500/5 text-orange-500/80';
    }
  }
  switch (status) {
    case 'COMPLETED':
      return 'border-success/40 bg-success/10 text-success';
    case 'ACTIVE':
      return 'border-info/40 bg-info/10 text-info';
    case 'HOLD':
    case 'REJECTED':
      return 'border-destructive/40 bg-destructive/10 text-destructive';
    default:
      return 'border-border bg-muted/30 text-muted-foreground';
  }
}

function stepLineColor(status: ProcessRouteStepView['status'], isReroll?: boolean): string {
  if (status === 'COMPLETED' || status === 'ACTIVE') {
    return isReroll ? 'bg-orange-500/50' : 'bg-success/50';
  }
  return 'bg-border';
}

function StepIcon({ status, isReroll }: { status: ProcessRouteStepView['status']; isReroll?: boolean }) {
  if (isReroll) return <RefreshCw className="h-3.5 w-3.5" aria-hidden />;
  if (status === 'COMPLETED') return <Check className="h-3.5 w-3.5" aria-hidden />;
  if (status === 'HOLD' || status === 'REJECTED') return <X className="h-3.5 w-3.5" aria-hidden />;
  if (status === 'ACTIVE') return <Circle className="h-3 w-3 fill-current" aria-hidden />;
  return <Circle className="h-3 w-3" aria-hidden />;
}

export function ProcessRouteTimeline({ steps, compact, direction = 'vertical' }: ProcessRouteTimelineProps) {
  if (steps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">No process route defined for this order.</p>
    );
  }

  if (direction === 'horizontal') {
    return (
      <div className="flex items-center w-full overflow-x-auto pb-4 pt-2 gap-0">
        {steps.map((step, idx) => (
          <div key={step.stepNo} className="flex items-center shrink-0">
            {/* Step Node */}
            <div className="flex flex-col items-center gap-2 relative z-10 w-24">
              <div
                className={[
                  'flex items-center justify-center rounded-full border shrink-0 transition-colors',
                  compact ? 'w-6 h-6' : 'w-10 h-10 shadow-sm',
                  stepColor(step.status, step.isReroll),
                  step.status === 'ACTIVE' ? 'ring-4 ring-info/10' : ''
                ].join(' ')}
              >
                <StepIcon status={step.status} isReroll={step.isReroll} />
              </div>
              
              <div className="text-center">
                <p className={['font-semibold truncate w-full px-1', compact ? 'text-[10px]' : 'text-xs'].join(' ')}>
                  {step.label}
                </p>
                {step.machineCode && (
                  <p className="font-mono text-[9px] font-bold opacity-80 mt-0.5">{step.machineCode}</p>
                )}
                {step.status === 'ACTIVE' && (
                  <p className="text-[9px] uppercase tracking-wider font-bold text-info mt-0.5">Active</p>
                )}
              </div>
            </div>

            {/* Connector Line */}
            {idx < steps.length - 1 && (
              <div 
                className={['h-0.5 w-12 -ml-6 -mr-6 -mt-8 relative z-0', stepLineColor(steps[idx].status, steps[idx].isReroll)].join(' ')} 
                aria-hidden 
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {steps.map((step, idx) => (
        <div key={step.stepNo} className="flex items-stretch gap-2">
          <div className="flex flex-col items-center w-4 shrink-0">
            <div
              className={[
                'flex items-center justify-center rounded-full border w-6 h-6 shrink-0',
                stepColor(step.status, step.isReroll),
              ].join(' ')}
            >
              <StepIcon status={step.status} isReroll={step.isReroll} />
            </div>
            {idx < steps.length - 1 && (
              <div className={["w-px flex-1 min-h-3 my-0.5", stepLineColor(step.status, step.isReroll)].join(' ')} aria-hidden />
            )}
          </div>
          <div
            className={[
              'flex-1 rounded-lg border px-3 py-2',
              stepColor(step.status, step.isReroll),
              compact ? 'text-xs' : 'text-sm',
            ].join(' ')}
          >
            <span className="font-semibold">{step.label}</span>
            {step.machineCode && (
              <span className="ml-2 font-mono text-[10px] font-bold opacity-80">{step.machineCode}</span>
            )}
            {step.isReroll && (
              <span className="ml-2 text-[10px] uppercase tracking-wider font-bold opacity-80">
                Reroll{step.rollingPassNo ? ` P${step.rollingPassNo}` : ''}
              </span>
            )}
            {step.status === 'ACTIVE' && !step.isReroll && (
              <span className="ml-2 text-[10px] uppercase tracking-wider font-bold opacity-80">Active</span>
            )}
            {step.status === 'ACTIVE' && step.isReroll && (
              <span className="ml-2 text-[10px] uppercase tracking-wider font-bold opacity-80">Active reroll</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
