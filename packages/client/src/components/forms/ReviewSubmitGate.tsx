import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { getRoleHomePath } from '../../lib/roleHome';
import { ZButton } from '../primitives/ZButton';
import type { SaveOutcome, SaveStatus } from '../../hooks/useEntryForm';
import type { ValidationError } from '@m1/shared-validation';
import { useGloveModeClasses } from '../../hooks/useGloveModeClasses';

export interface ReviewSubmitGateProps {
  values: Record<string, unknown>;
  errors: ValidationError[];
  isDirty: boolean;
  saveStatus: SaveStatus;
  onSave: () => Promise<SaveOutcome>;
  disabled?: boolean;
}

export function ReviewSubmitGate({ values, errors, saveStatus, onSave, disabled }: ReviewSubmitGateProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { saveHeight } = useGloveModeClasses();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const username = useAuthStore((s) => s.username);

  const handleReviewClick = () => {
    setIsOpen(true);
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    const outcome = await onSave();
    setIsSubmitting(false);

    if (outcome.outcome !== 'blocked') {
      setIsOpen(false);
      navigate(getRoleHomePath(role, lineAccess, machineAccess, username));
    }
  };

  return (
    <>
      <ZButton
        onClick={handleReviewClick}
        disabled={disabled || saveStatus === 'queued' || saveStatus === 'transmitted'}
        variant="accent"
        fullWidth
        size="lg"
        className={saveHeight}
      >
        Review &amp; submit
      </ZButton>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-card border border-border rounded-2xl shadow-lg w-full max-w-lg overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-semibold">Review & Submit Coil</h3>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                &times;
              </button>
            </div>
            
            <div className="p-6 flex-1 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-muted-foreground mb-4">
                Please review the captured parameters before final submission. This will transition the coil status and return you to the dashboard.
              </p>
              
              <div className="space-y-3 bg-secondary/50 rounded-lg p-4">
                {Object.entries(values).filter(([k, v]) => v !== undefined && v !== '' && k !== 'id' && k !== 'shiftLogId').map(([key, value]) => (
                  <div key={key} className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <span className="font-medium text-muted-foreground">{key}</span>
                    <span className="font-mono truncate max-w-[60%]">{String(value)}</span>
                  </div>
                ))}
              </div>

              {errors.length > 0 && (
                <div className="mt-4 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm space-y-1">
                  <div className="font-semibold mb-2">Validation Blocks:</div>
                  {errors.map((e, i) => (
                    <div key={i}>• {e.message}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border bg-muted/30 flex gap-3">
              <button
                onClick={() => setIsOpen(false)}
                className="flex-1 h-12 rounded-md border border-border font-medium hover:bg-secondary transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={isSubmitting || errors.length > 0}
                className="flex-1 h-12 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center"
              >
                {isSubmitting ? <span className="animate-pulse">Submitting...</span> : 'Confirm & Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
