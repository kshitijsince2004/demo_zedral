import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bootstrapShiftContext } from '../../lib/shiftDetection';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useElapsedTimer } from '../../hooks/useElapsedTimer';
import {
  machineHandoverService,
  type PendingHandover,
  type HandoverProductionSnapshot,
  type QueueItem,
  type ActiveOrderDetail,
  resolveHandoverQueueSnapshot,
} from '../../services/machineHandoverService';
import { ZButton } from '../../components/primitives/ZButton';
import { OperatorShell } from '../../components/layout/operator/OperatorShell';
import {
  AlertTriangle, CheckCircle2, Package, ChevronRight,
  Users, Wrench, Clock, AlertCircle, FileText,
} from 'lucide-react';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { flattenHandoverQueue } from '../../lib/handoverQueue';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-600 border-slate-300',
  MEDIUM: 'bg-blue-100 text-blue-700 border-blue-300',
  HIGH: 'bg-amber-100 text-amber-700 border-amber-300',
};

const STATUS_DOT: Record<string, string> = {
  RUNNING: 'bg-emerald-500',
  IDLE: 'bg-slate-400',
  STOPPAGE: 'bg-amber-500',
  BREAKDOWN: 'bg-red-600',
  MAINTENANCE: 'bg-blue-500',
};

const CONDITION_BADGE: Record<string, string> = {
  NORMAL: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  ATTENTION_REQUIRED: 'bg-amber-50 text-amber-700 border-amber-300',
  CRITICAL: 'bg-red-50 text-red-700 border-red-300',
};

function InfoBlock({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
      <p className={`font-semibold text-foreground text-sm ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</p>
    </div>
  );
}

function SectionCard({ icon, title, children, highlight }: {
  icon: React.ReactNode; title: string; children: React.ReactNode; highlight?: 'amber' | 'red' | 'green';
}) {
  const border = highlight === 'amber'
    ? 'border-amber-300 bg-amber-50/30'
    : highlight === 'red'
    ? 'border-red-300 bg-red-50/30'
    : highlight === 'green'
    ? 'border-emerald-300 bg-emerald-50/30'
    : 'border-border bg-white';

  return (
    <div className={`border-2 rounded-2xl overflow-hidden ${border}`}>
      <div className="flex items-center gap-2 px-5 py-3 border-b border-inherit bg-white/50">
        <div className="text-muted-foreground">{icon}</div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-3 bg-secondary rounded-full overflow-hidden">
      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

interface HandoverAcceptPageProps {
  handover: PendingHandover;
  onAccepted: () => void;
}

export function HandoverAcceptPage({ handover, onAccepted }: HandoverAcceptPageProps) {
  const navigate = useNavigate();
  const { basePath, machineCode } = useWorkspaceBase();
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyNotes, setClarifyNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ps = handover.production_snapshot as HandoverProductionSnapshot;
  const activeOrder = ps?.activeOrderDetail as ActiveOrderDetail | null | undefined;
  const orderSnapshot = ps?.orderSnapshot;
  const shiftSummary = ps?.shiftProductionSummary;
  const machineCondition = ps?.machineCondition ?? 'NORMAL';
  const conditionRemarks = ps?.machineConditionRemarks;
  const crewNotes = ps?.crewNotes;
  const selectedCrewMembers = ps?.selectedCrewMembers ?? [];
  const shiftFields = ps?.shiftManualFields;

  const queue = resolveHandoverQueueSnapshot(handover);
  const allQueueItems: QueueItem[] = flattenHandoverQueue(queue, 15);

  const openStoppages = (handover.open_stoppages ?? []) as Array<{
    startAt?: string; reason?: string; status?: string;
  }>;
  const hasActiveStoppage = openStoppages.length > 0;

  const priority = handover.handover_priority ?? 'MEDIUM';

  const runtimeTimer = useElapsedTimer(activeOrder?.startTime ?? undefined);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await machineHandoverService.accept(handover.handover_id);
      await bootstrapShiftContext(machineCode);
      onAccepted();
      navigate(basePath);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Accept failed');
    } finally {
      setBusy(false);
    }
  };

  const submitClarify = async () => {
    if (!clarifyNotes.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await machineHandoverService.requestClarification(handover.handover_id, clarifyNotes);
      navigate('/login');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  function formatMin(min?: number) {
    if (min == null) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <OperatorShell processCode={machineCode}>
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 bg-white border-b border-border/60 px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-0.5">Incoming Operator · Handover Briefing</p>
              <h1 className="text-2xl font-black text-foreground">{handover.machine_code}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Review before accepting. You cannot modify production until accepted.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${PRIORITY_STYLES[priority]}`}>
                {priority} PRIORITY
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[handover.machine_status] ?? 'bg-slate-400'}`} />
                <span className="text-xs font-bold text-foreground">{handover.machine_status}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-5 space-y-5 pb-40">

            {/* Active Stoppage Banner */}
            {hasActiveStoppage && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl px-5 py-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                <div>
                  <p className="font-bold text-amber-800 text-sm">Machine currently in stoppage mode</p>
                  <p className="text-xs text-amber-700">Contact outgoing operator or machine head before accepting if unresolved.</p>
                </div>
              </div>
            )}

            {/* ── PANEL 1: Machine Status ── */}
            <SectionCard
              icon={<Wrench className="h-4 w-4" />}
              title="Machine Status"
              highlight={machineCondition === 'CRITICAL' ? 'red' : machineCondition === 'ATTENTION_REQUIRED' ? 'amber' : 'green'}
            >
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-2 bg-white rounded-xl border px-4 py-2.5">
                  <span className={`w-3 h-3 rounded-full ${STATUS_DOT[handover.machine_status] ?? 'bg-slate-400'}`} />
                  <span className="font-bold text-sm">{handover.machine_status}</span>
                </div>
                <div className={`border-2 rounded-xl px-4 py-2 text-sm font-bold ${CONDITION_BADGE[machineCondition]}`}>
                  {machineCondition.replace(/_/g, ' ')}
                </div>
              </div>
              {conditionRemarks && (
                <div className="bg-white border border-border rounded-xl p-3">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Condition Remarks</p>
                  <p className="text-sm text-foreground">{conditionRemarks}</p>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <InfoBlock label="Outgoing Shift" value={`${handover.outgoing_prod_date} · ${handover.outgoing_shift_code}`} />
                <InfoBlock label="Incoming Shift" value={handover.incoming_shift_code} />
                {shiftFields?.scrapKg != null && <InfoBlock label="Scrap Generated" value={`${shiftFields.scrapKg} Kg`} />}
                {shiftFields?.coolantTempDegC != null && <InfoBlock label="Coolant Temp" value={`${shiftFields.coolantTempDegC} °C`} />}
                {shiftFields?.coolantPressKgCm2 != null && <InfoBlock label="Coolant Pressure" value={`${shiftFields.coolantPressKgCm2} Kg/cm²`} />}
                {shiftFields?.shiftRemarks && <InfoBlock label="Shift Remarks" value={shiftFields.shiftRemarks} />}
              </div>
            </SectionCard>

            {/* ── PANEL 2: Production Summary ── */}
            {shiftSummary && (
              <SectionCard icon={<CheckCircle2 className="h-4 w-4" />} title="Outgoing Shift Production">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                    <p className="text-xl font-black text-emerald-700">{shiftSummary.totalProdMt.toFixed(3)}</p>
                    <p className="text-[10px] font-bold text-emerald-500 uppercase">Total MT</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-3 text-center">
                    <p className="text-xl font-black text-foreground">{shiftSummary.completedOrderCount}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Completed</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-3 text-center">
                    <p className="text-xl font-black text-foreground">{shiftSummary.machineUtilizationPct}%</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Runtime Utilization</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-3 text-center">
                    <p className="text-xl font-black text-foreground">{formatMin(shiftSummary.totalStoppageMinutes)}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Stoppage</p>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* ── PANEL 3: Current Running Order ── */}
            {activeOrder ? (
              <SectionCard icon={<Package className="h-4 w-4" />} title="Running Order" highlight="green">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <InfoBlock label="Batch Number" value={activeOrder.batchNumber} mono />
                  <InfoBlock label="Customer" value={activeOrder.customer} />
                  <InfoBlock label="Process" value={activeOrder.subProcess?.replace(/_/g, ' ')} />
                  <InfoBlock label="Runtime" value={runtimeTimer} />
                  <InfoBlock label="Produced" value={activeOrder.producedWeightMt != null ? `${activeOrder.producedWeightMt} MT` : '—'} />
                  <InfoBlock label="Remaining" value={activeOrder.remainingWeightMt != null ? `${activeOrder.remainingWeightMt.toFixed(3)} MT` : '—'} />
                  <InfoBlock label="Target Weight" value={`${activeOrder.targetWeightMt ?? '—'} MT`} />
                  <InfoBlock label="Destination" value={activeOrder.destinationProcess ?? '—'} />
                </div>
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-bold">{activeOrder.progressPct ?? 0}%</span>
                  </div>
                  <ProgressBar pct={activeOrder.progressPct ?? 0} />
                </div>
                {/* Order Snapshot from outgoing operator */}
                {orderSnapshot && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2">Order Snapshot from Outgoing Operator</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {orderSnapshot.currentStage && <InfoBlock label="Current Stage" value={orderSnapshot.currentStage} />}
                      {orderSnapshot.currentPassNumber && <InfoBlock label="Pass No" value={orderSnapshot.currentPassNumber} />}
                      {orderSnapshot.currentThicknessMm && <InfoBlock label="Current Thickness" value={`${orderSnapshot.currentThicknessMm} mm`} />}
                      {orderSnapshot.targetThicknessMm && <InfoBlock label="Target Thickness" value={`${orderSnapshot.targetThicknessMm} mm`} />}
                    </div>
                    {orderSnapshot.nextActionRequired && (
                      <div className="bg-white border border-blue-200 rounded-lg p-3 mt-2">
                        <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">Next Action Required</p>
                        <p className="text-sm font-semibold text-foreground">{orderSnapshot.nextActionRequired}</p>
                      </div>
                    )}
                    {orderSnapshot.orderRemarks && (
                      <div className="bg-white border border-blue-200 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">Order Remarks</p>
                        <p className="text-sm text-foreground">{orderSnapshot.orderRemarks}</p>
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>
            ) : (
              <SectionCard icon={<Package className="h-4 w-4" />} title="Running Order">
                <p className="text-sm text-muted-foreground text-center py-2">No active order — machine was idle at handover</p>
              </SectionCard>
            )}

            {/* ── PANEL 4: Open Stoppages ── */}
            {openStoppages.length > 0 && (
              <SectionCard icon={<AlertCircle className="h-4 w-4" />} title="Open Stoppages" highlight="amber">
                <div className="divide-y divide-amber-200/50">
                  {openStoppages.map((s, i) => (
                    <div key={i} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-amber-800 text-sm">{s.reason ?? 'Unknown reason'}</p>
                        <p className="text-xs text-amber-600">{s.startAt ? new Date(s.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                      </div>
                      <span className="text-xs font-black bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">OPEN</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* ── PANEL 5: Queue ── */}
            {allQueueItems.length > 0 && (
              <SectionCard icon={<ChevronRight className="h-4 w-4" />} title="Upcoming Queue">
                <div className="space-y-2">
                  {allQueueItems.map((item, i) => (
                    <div key={item.batchNumber} className="flex items-center gap-3 bg-secondary/30 rounded-xl px-4 py-3">
                      <span className="w-6 h-6 bg-primary/10 text-primary text-xs font-black rounded-full flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono font-bold text-sm text-primary">
                          {displayMotherCoilId({ motherCoil: item.motherCoil, batchNumber: item.batchNumber, slitId: item.slitId })}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Batch {item.batchNumber}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.customer ?? '—'} · {item.subProcess?.replace(/_/g, ' ')}</p>
                      </div>
                      <span className="text-xs font-bold text-muted-foreground shrink-0">{item.weightMt ? `${item.weightMt} MT` : '—'}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* ── PANEL 6: Crew ── */}
            {(selectedCrewMembers.length > 0 || crewNotes) && (
              <SectionCard icon={<Users className="h-4 w-4" />} title="Crew Details">
                {selectedCrewMembers.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {selectedCrewMembers.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 bg-secondary/30 rounded-xl px-4 py-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-black flex items-center justify-center">
                          {c.memberName[0]}
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-foreground">{c.memberName}</p>
                          <p className="text-xs text-muted-foreground">{c.roleLabel}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {crewNotes && (
                  <p className="text-sm text-foreground whitespace-pre-wrap">{crewNotes}</p>
                )}
              </SectionCard>
            )}

            {/* ── PANEL 7: Outgoing Notes (PRIMARY) ── */}
            <SectionCard icon={<FileText className="h-4 w-4" />} title="Outgoing Operator Notes" highlight="amber">
              <div className="bg-white border border-amber-200 rounded-xl p-4">
                <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground">{handover.remarks}</p>
              </div>
              {shiftFields?.shiftRemarks && (
                <div className="bg-white border border-border rounded-xl p-4 mt-3">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Shift Remarks</p>
                  <p className="text-sm text-foreground">{shiftFields.shiftRemarks}</p>
                </div>
              )}
            </SectionCard>

            {/* Handover Created At */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <Clock className="h-3.5 w-3.5" />
              Handover created: {formatPlantDateTime(handover.created_at)}
            </div>

            {/* Error */}
            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-2xl px-5 py-4 flex gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-destructive text-sm font-medium">{error}</p>
              </div>
            )}

            {/* Clarify form */}
            {clarifyOpen && (
              <div className="bg-white border-2 border-primary/20 rounded-2xl p-5 space-y-3">
                <h3 className="font-bold text-sm">Request Clarification</h3>
                <p className="text-xs text-muted-foreground">
                  Describe what you need clarification on. The outgoing operator will be notified.
                  This will log you out after sending.
                </p>
                <textarea
                  className="w-full min-h-[100px] rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={clarifyNotes}
                  onChange={(e) => setClarifyNotes(e.target.value)}
                  placeholder="e.g. What is the current rolling pass thickness? Is the vibration issue resolved?"
                  id="handover-clarify-notes"
                />
                <div className="flex gap-3">
                  <ZButton variant="accent" disabled={busy || !clarifyNotes.trim()} onClick={submitClarify}>
                    Send & Sign Out
                  </ZButton>
                  <ZButton variant="ghost" onClick={() => setClarifyOpen(false)}>Cancel</ZButton>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 bg-white border-t border-border/60 px-5 py-4 flex gap-3">
          <ZButton
            variant="accent"
            size="lg"
            className="min-h-[52px] flex-[2]"
            disabled={busy}
            onClick={accept}
          >
            {busy ? 'Accepting…' : '✓ Accept Handover & Start Shift'}
          </ZButton>
          {!clarifyOpen && (
            <ZButton
              variant="secondary"
              size="lg"
              className="min-h-[52px] flex-1"
              disabled={busy}
              onClick={() => setClarifyOpen(true)}
            >
              Request Clarification
            </ZButton>
          )}
        </div>
      </div>
    </OperatorShell>
  );
}
