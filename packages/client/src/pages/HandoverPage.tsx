import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Check } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import { getRoleHomePath } from '../lib/roleHome';
import { OperatorShell } from '../components/layout/operator/OperatorShell';
import { AnalyticsMetric } from '../components/analytics/AnalyticsMetric';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ZButton } from '../components/primitives/ZButton';
import { ZInput } from '../components/primitives/ZInput';
import { ZOperatorCard } from '../components/ui/operator/ZOperatorCard';
import { ZPageHeader } from '../components/ui/operator/ZPageHeader';
import { useShiftStore } from '../store/shiftStore';
import { apiClient } from '../lib/apiClient';

interface HandoverSummary {
  shiftLogId: string;
  targetMt: number;
  producedMt: number;
  openCoils: string[];
  openCoilCount: number;
  runningStoppages: {
    id: string;
    reason: string;
    fromTime: string;
    remarks: string | null;
  }[];
  runningStoppageCount: number;
  nextShift: { shiftCode: string; prodDate: string };
  notes: string;
}

export function HandoverPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const username = useAuthStore((s) => s.username);
  const homePath = getRoleHomePath(role, lineAccess, machineAccess, username);
  const { logout } = useAuthStore();
  const {
    targetMt,
    producedMt,
    plannedCoils,
    processLine,
    stoppages,
    runningStoppage,
    defects,
  } = useShiftStore();

  const [step, setStep] = useState<1 | 2>(1);
  const [incomingBadge, setIncomingBadge] = useState('');
  const [incomingPin, setIncomingPin] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [summary, setSummary] = useState<HandoverSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const shiftLogId = useShiftStore((s) => s.shiftLogId);

  useEffect(() => {
    if (!shiftLogId) return;

    let cancelled = false;
    setSummaryLoading(true);

    apiClient
      .get<HandoverSummary>(`/shift-logs/${shiftLogId}/handover/summary`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((e) => {
        console.error('Failed to load handover summary', e);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shiftLogId]);

  const openCoilsFromStore = plannedCoils.filter((c) => c.status === 'open');
  const doneCoils = plannedCoils.filter((c) => c.status === 'done');

  const displayTargetMt = summary?.targetMt ?? targetMt;
  const displayProducedMt = summary?.producedMt ?? producedMt;
  const displayOpenCoils = summary?.openCoils ?? openCoilsFromStore.map((c) => c.coilNo);
  const displayRunningStoppages =
    summary?.runningStoppages ??
    (runningStoppage
      ? [
          {
            id: runningStoppage.id,
            reason: runningStoppage.reason,
            fromTime: runningStoppage.fromTime,
            remarks: runningStoppage.remarks,
          },
        ]
      : []);
  const totalStoppageMins = stoppages.reduce((sum, s) => sum + (s.durationMins || 0), 0);

  const handleSignOff = async () => {
    const activeShiftLogId = useShiftStore.getState().shiftLogId;
    if (!activeShiftLogId) {
      if (incomingBadge === '3344' && incomingPin === '4321') {
        logout();
        navigate('/login');
        return;
      }
      setError('Invalid incoming operator credentials');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');

      const res = await fetch(`/api/shift-logs/${activeShiftLogId}/handover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().token}`,
        },
        body: JSON.stringify({
          incomingBadge,
          incomingPin,
          notes,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (err.validationResult?.errors?.length) {
          const details = err.validationResult.errors
            .map((e: { field: string; message: string }) => `${e.field}: ${e.message}`)
            .join('; ');
          throw new Error(`Validation failed — ${details}`);
        }
        throw new Error(err.error || 'Handover failed');
      }

      const data = await res.json();
      useShiftStore.getState().setShiftLogId(data.newShiftLogId);
      logout();
      navigate('/login');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Handover failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OperatorShell processCode={processLine || 'HRS'}>
      <div className="flex-1 overflow-auto z-op-canvas p-4 md:p-5 flex flex-col gap-4 max-w-3xl">
        <ZPageHeader title="Shift Handover" subtitle={`${processLine} · End of shift sign-off`} />
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="h-4 w-4 text-accent shrink-0" aria-hidden />
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`px-2 py-1 rounded-sm border font-medium ${
                step === 1 ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-muted-foreground'
              }`}
            >
              1 · Summary
            </span>
            <span className="text-muted-foreground">→</span>
            <span
              className={`px-2 py-1 rounded-sm border font-medium ${
                step === 2 ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-muted-foreground'
              }`}
            >
              2 · Sign-off
            </span>
          </div>
        </div>

        {step === 1 && (
          <>
            {summaryLoading && (
              <p className="text-sm text-muted-foreground">Loading handover summary…</p>
            )}

            {summary?.nextShift && (
              <p className="text-xs text-muted-foreground">
                Next shift: <span className="font-mono">{summary.nextShift.shiftCode}</span>
                {' · '}
                {new Date(summary.nextShift.prodDate).toLocaleDateString()}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <AnalyticsMetric
                label="Produced"
                value={`${displayProducedMt.toFixed(1)} MT`}
                sub={`Target ${displayTargetMt} MT`}
              />
              <AnalyticsMetric label="Coils done" value={doneCoils.length} />
              <AnalyticsMetric
                label="Stoppages"
                value={`${totalStoppageMins} min`}
                sub={`${stoppages.length} events`}
              />
              <AnalyticsMetric
                label="Defects"
                value={defects.length}
                deltaTone={defects.length > 0 ? 'destructive' : 'muted'}
              />
            </div>

            <ZOperatorCard
              title="Open items to carry over"
              meta={displayOpenCoils.length > 0 ? <StatusBadge tone="warning" label={`${displayOpenCoils.length} open`} /> : undefined}
            >
              <div className="flex flex-col gap-3 -m-4 p-4">
                {displayRunningStoppages.map((stoppage) => (
                  <div
                    key={stoppage.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-sm border border-destructive/30 bg-destructive/10"
                  >
                    <span className="text-sm font-medium text-destructive flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full bg-destructive animate-pulse-dot" />
                      Running stoppage: {stoppage.reason}
                    </span>
                    <span className="font-mono text-xs text-destructive">since {stoppage.fromTime}</span>
                  </div>
                ))}

                {displayOpenCoils.length > 0 ? (
                  displayOpenCoils.map((coilNo) => (
                    <div
                      key={coilNo}
                      className="flex items-center justify-between px-3 py-2.5 rounded-sm border border-warning/40 bg-warning/10"
                    >
                      <span className="font-mono text-xs text-warning">{coilNo}</span>
                      <StatusBadge tone="warning" label="OPEN" />
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-4 flex items-center justify-center gap-2">
                    <Check className="h-4 w-4 text-success" aria-hidden />
                    No open coils — all work complete
                  </div>
                )}

                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="z-rail-label">Handover notes (optional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes for the incoming shift…"
                    rows={3}
                    className="rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
            </ZOperatorCard>

            <div className="flex items-center gap-2">
              <ZButton variant="secondary" onClick={() => navigate(homePath)}>
                Cancel
              </ZButton>
              <ZButton variant="accent" onClick={() => setStep(2)}>
                Confirm & proceed
              </ZButton>
            </div>
          </>
        )}

        {step === 2 && (
          <ZOperatorCard
            title="Incoming operator sign-off"
            meta={<StatusBadge tone="warning" label="PENDING" />}
            className="max-w-lg"
          >
            <div className="flex flex-col gap-4 -m-4 p-4">
              <p className="text-sm text-muted-foreground">
                Incoming operator must authenticate to accept the handover and assume terminal control.
              </p>

              {error && (
                <div className="px-3 py-2 rounded-sm border border-destructive/30 bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <ZInput
                label="Badge ID"
                value={incomingBadge}
                onChange={(e) => setIncomingBadge(e.target.value)}
                placeholder="Scan or type badge"
              />

              <ZInput
                label="PIN"
                type="password"
                value={incomingPin}
                onChange={(e) => setIncomingPin(e.target.value)}
                placeholder="4-digit PIN"
              />

              <div className="flex items-center gap-2 pt-2">
                <ZButton variant="secondary" onClick={() => setStep(1)}>
                  Back
                </ZButton>
                <div className="flex-1" />
                <ZButton
                  variant="accent"
                  onClick={handleSignOff}
                  disabled={!incomingBadge || !incomingPin || isSubmitting}
                >
                  {isSubmitting ? 'Processing…' : 'Complete handover'}
                </ZButton>
              </div>
            </div>
          </ZOperatorCard>
        )}
      </div>
    </OperatorShell>
  );
}
