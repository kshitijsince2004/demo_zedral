import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useElapsedTimer } from '../../hooks/useElapsedTimer';
import {
  machineHandoverService,
  type HandoverPreview,
  type OrderSnapshot,
} from '../../services/machineHandoverService';
import { ZButton } from '../../components/primitives/ZButton';
import {
  AlertTriangle, CheckCircle2, Clock, Package, Users, Wrench,
  ChevronRight, ChevronDown, Lock, Edit3, AlertCircle, Zap, BarChart2,
} from 'lucide-react';
import { formatPlantClock, formatPlantDateTime } from '../../lib/dateFormat';
import { flattenHandoverQueue } from '../../lib/handoverQueue';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { machineCrewService, type MachineCrewMember } from '../../lib/machineCrewService';
import { useManualDraft } from '../../lib/useFormDraft';

// ── Constants ─────────────────────────────────────────────────────────────────

const MACHINE_STATUSES = ['RUNNING', 'IDLE', 'BREAKDOWN', 'MAINTENANCE', 'STOPPAGE'] as const;
const MACHINE_CONDITIONS = ['NORMAL', 'ATTENTION_REQUIRED', 'CRITICAL'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
type Priority = typeof PRIORITIES[number];

const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: 'bg-slate-100 text-slate-600 border-slate-300',
  MEDIUM: 'bg-blue-100 text-blue-700 border-blue-300',
  HIGH: 'bg-amber-100 text-amber-700 border-amber-300',
};

const CONDITION_COLORS: Record<string, string> = {
  NORMAL: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  ATTENTION_REQUIRED: 'bg-amber-100 text-amber-700 border-amber-300',
  CRITICAL: 'bg-red-100 text-red-700 border-red-400',
};

const STATUS_COLORS: Record<string, string> = {
  RUNNING: 'bg-emerald-500 text-white',
  IDLE: 'bg-slate-400 text-white',
  BREAKDOWN: 'bg-red-600 text-white',
  MAINTENANCE: 'bg-blue-500 text-white',
  STOPPAGE: 'bg-amber-500 text-white',
};

const MIN_NOTES_LENGTH = 20;
const AUTO_SAVE_MS = 30_000;

// ── Helper Components ─────────────────────────────────────────────────────────

function SectionHeader({ icon, title, badge, locked }: {
  icon: React.ReactNode; title: string; badge?: string; locked?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-secondary text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="flex-1">
        <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">{title}</h2>
        {badge && <span className="text-[10px] text-muted-foreground">{badge}</span>}
      </div>
      {locked && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
          <Lock className="h-3 w-3" />
          AUTO
        </div>
      )}
    </div>
  );
}

function LockedField({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
      <p className="font-semibold text-foreground text-sm">{value ?? '—'}</p>
    </div>
  );
}

function ManualField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-foreground mb-1.5">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function inputClass(error?: boolean) {
  return `w-full min-h-[44px] rounded-xl border ${error ? 'border-destructive bg-destructive/5' : 'border-input bg-background'} px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors`;
}

function ToggleChip({ value, active, onClick, colorClass }: {
  value: string; active: boolean; onClick: () => void; colorClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'min-h-[44px] px-4 rounded-xl border-2 text-sm font-bold transition-all duration-150',
        active ? (colorClass ?? 'bg-primary text-primary-foreground border-primary') : 'border-border text-muted-foreground hover:border-muted-foreground',
      ].join(' ')}
    >
      {value.replace(/_/g, ' ')}
    </button>
  );
}

// ── Prog bar ──────────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-3 bg-secondary rounded-full overflow-hidden">
      <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

export function CrmOutgoingHandoverPage() {
  const navigate = useNavigate();
  const { basePath, machineCode } = useWorkspaceBase();
  const { logout } = useAuthStore();

  // ── State ──────────────────────────────────────────────────────────────────
  const [preview, setPreview] = useState<HandoverPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Section 3 — manual shift fields
  const [scrapKg, setScrapKg] = useState('');
  const [coolantTemp, setCoolantTemp] = useState('');
  const [coolantPress, setCoolantPress] = useState('');
  const [shiftRemarks, setShiftRemarks] = useState('');

  // Section 5 — order snapshot
  const [orderSnapshot, setOrderSnapshot] = useState<OrderSnapshot>({});

  // Section 6 — machine condition
  const [machineStatus, setMachineStatus] = useState('IDLE');
  const [machineCondition, setMachineCondition] = useState('NORMAL');
  const [conditionRemarks, setConditionRemarks] = useState('');

  // Section 9 — crew notes
  const [crewNotes, setCrewNotes] = useState('');
  const [crewRoster, setCrewRoster] = useState<MachineCrewMember[]>([]);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());

  const [queueExpanded, setQueueExpanded] = useState(true);

  // Section 10 — outgoing notes (mandatory)
  const [outgoingNotes, setOutgoingNotes] = useState('');
  const [notesError, setNotesError] = useState('');

  // Priority
  const [priority, setPriority] = useState<Priority>('MEDIUM');

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);

  const autoSaveRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Load preview + draft ───────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      machineHandoverService.getPreview(machineCode),
      machineHandoverService.getDraft(machineCode),
    ])
      .then(([p, { draft }]) => {
        setPreview(p);
        setMachineStatus(p.machineStatus);
        // Restore draft if exists
        if (draft) {
          setDraftId(draft.handover_id);
          const ps = draft.production_snapshot as Record<string, unknown>;
          const sm = ps?.shiftManualFields as Record<string, unknown> | null;
          const sum = p.shiftProductionSummary;
          setScrapKg(String(sm?.scrapKg ?? sum?.scrapKg ?? ''));
          setCoolantTemp(String(sm?.coolantTempDegC ?? sum?.coolantTempDegC ?? ''));
          setCoolantPress(String(sm?.coolantPressKgCm2 ?? sum?.coolantPressKgCm2 ?? ''));
          if (sm?.shiftRemarks != null) setShiftRemarks(String(sm.shiftRemarks ?? ''));
          if (ps?.orderSnapshot) setOrderSnapshot(ps.orderSnapshot as OrderSnapshot);
          if (ps?.machineCondition) setMachineCondition(String(ps.machineCondition));
          if (ps?.machineConditionRemarks) setConditionRemarks(String(ps.machineConditionRemarks));
          if (ps?.crewNotes) setCrewNotes(String(ps.crewNotes));
          setOutgoingNotes(draft.remarks ?? '');
          if (draft.handover_priority) setPriority(draft.handover_priority as Priority);
          if (draft.machine_status) setMachineStatus(draft.machine_status);
        } else {
          // Prefill from in-shift Shift Readings already on crm_shift_summary (§13 B3).
          const sum = p.shiftProductionSummary;
          if (sum?.scrapKg != null) setScrapKg(String(sum.scrapKg));
          if (sum?.coolantTempDegC != null) setCoolantTemp(String(sum.coolantTempDegC));
          if (sum?.coolantPressKgCm2 != null) setCoolantPress(String(sum.coolantPressKgCm2));
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [machineCode]);

  useEffect(() => {
    if (!preview?.machineCode) return;
    if (preview.machineCrewRoster?.length) {
      setCrewRoster(preview.machineCrewRoster.map((c) => ({
        id: c.id,
        machineCode: preview.machineCode,
        memberName: c.memberName,
        roleLabel: c.roleLabel,
      })));
      return;
    }
    void machineCrewService
      .list(preview.machineCode)
      .then((res) => setCrewRoster(res.crew))
      .catch(() => setCrewRoster([]));
  }, [preview?.machineCode, preview?.machineCrewRoster]);

  const toggleRosterMember = (member: MachineCrewMember) => {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(member.id)) next.delete(member.id);
      else next.add(member.id);
      const selected = crewRoster.filter((c) => next.has(c.id));
      setCrewNotes(selected.map((c) => `${c.memberName} (${c.roleLabel})`).join(', '));
      return next;
    });
  };

  // ── Auto-save draft ────────────────────────────────────────────────────────
  const buildPayload = useCallback(() => ({
    machineStatus,
    machineCondition,
    machineConditionRemarks: conditionRemarks || undefined,
    remarks: outgoingNotes,
    handoverPriority: priority,
    scrapKg: scrapKg ? Number(scrapKg) : undefined,
    coolantTempDegC: coolantTemp ? Number(coolantTemp) : undefined,
    coolantPressKgCm2: coolantPress ? Number(coolantPress) : undefined,
    shiftRemarks: shiftRemarks || undefined,
    orderSnapshot: Object.keys(orderSnapshot).length ? orderSnapshot : undefined,
    crewNotes: crewNotes || undefined,
    selectedCrewIds: selectedRosterIds.size ? [...selectedRosterIds] : undefined,
  }), [machineStatus, machineCondition, conditionRemarks, outgoingNotes, priority, scrapKg, coolantTemp, coolantPress, shiftRemarks, orderSnapshot, crewNotes, selectedRosterIds]);

  const saveDraft = useCallback(async () => {
    if (!preview) return;
    setSaving(true);
    setDraftError(null);
    try {
      const saved = await machineHandoverService.saveDraft(machineCode, buildPayload());
      setDraftId(saved.handover_id);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 403) {
        setDraftError('Access Denied: Please re-login to refresh permissions');
      } else {
        setDraftError('Draft failed to save on server');
      }
    } finally {
      setSaving(false);
    }
  }, [machineCode, preview, buildPayload]);

  // Server Auto-save on changes
  useEffect(() => {
    if (!preview) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(saveDraft, AUTO_SAVE_MS);
    return () => clearTimeout(autoSaveRef.current);
  }, [saveDraft, preview]);

  const draftValues = useMemo(() => buildPayload(), [buildPayload]);

  // Local auto-save draft
  const { clearDraft } = useManualDraft(
    draftValues,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCallback((parsed: any) => {
      if (parsed.machineStatus) setMachineStatus(parsed.machineStatus);
      if (parsed.machineCondition) setMachineCondition(parsed.machineCondition);
      if (parsed.machineConditionRemarks) setConditionRemarks(parsed.machineConditionRemarks);
      if (parsed.remarks) setOutgoingNotes(parsed.remarks);
      if (parsed.handoverPriority) setPriority(parsed.handoverPriority);
      if (parsed.scrapKg) setScrapKg(String(parsed.scrapKg));
      if (parsed.coolantTempDegC) setCoolantTemp(String(parsed.coolantTempDegC));
      if (parsed.coolantPressKgCm2) setCoolantPress(String(parsed.coolantPressKgCm2));
      if (parsed.shiftRemarks) setShiftRemarks(parsed.shiftRemarks);
      if (parsed.orderSnapshot) setOrderSnapshot(parsed.orderSnapshot);
      if (parsed.crewNotes) setCrewNotes(parsed.crewNotes);
      if (parsed.selectedCrewIds) setSelectedRosterIds(new Set(parsed.selectedCrewIds));
    }, []),
    `handover_${machineCode}`
  );

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (outgoingNotes.trim().length < MIN_NOTES_LENGTH) {
      setNotesError(`Please enter at least ${MIN_NOTES_LENGTH} characters`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await machineHandoverService.submitOutgoing(machineCode, {
        ...buildPayload(),
        remarks: outgoingNotes.trim(),
      });
      clearDraft();
      // Only sign out after the server has PENDING handover + closed session.
      await logout();
      navigate('/login', { replace: true });
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Handover submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Runtime timer ──────────────────────────────────────────────────────────
  const runtimeTimer = useElapsedTimer(preview?.activeOrderDetail?.startTime ?? undefined);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading handover console…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
          <p className="text-destructive font-semibold">{loadError}</p>
          <ZButton variant="secondary" onClick={() => navigate(basePath)}>Go Back</ZButton>
        </div>
      </div>
    );
  }

  const p = preview!;
  const activeOrder = p.activeOrderDetail;
  const openStoppages = (p.openStoppages ?? []) as Array<{ startAt?: string; reason?: string; status?: string }>;
  const hasActiveStoppage = openStoppages.some((s) => !s.status || s.status === 'OPEN');
  const prod = p.shiftProductionSummary;
  const queue = p.queueSnapshot;
  const allQueueItems = flattenHandoverQueue(queue, 10);

  const scheduledShiftStart = p.shift.windowStart ?? '—';
  const scheduledShiftEnd = p.shift.windowEnd ?? '—';
  const actualSessionStart = p.shift.actualSessionStartAt
    ? formatPlantDateTime(p.shift.actualSessionStartAt)
    : '—';

  function formatMin(min?: number) {
    if (min == null) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Page Header ── */}
        <div className="shrink-0 bg-white border-b border-border/60 px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-0.5">End Shift · Handover Console</p>
              <h1 className="text-2xl font-black text-foreground">{p.machineName}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Transfer responsibility · {p.shift.shiftCode} shift → {p.nextShift.shiftCode} shift
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${PRIORITY_COLORS[priority]}`}>
                {priority} PRIORITY
              </div>
              {draftSaved && (
                <div className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Draft saved
                </div>
              )}
              {draftError && (
                <div className="flex items-center gap-1 text-xs text-destructive font-medium bg-destructive/10 px-2 py-1 rounded-md">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {draftError}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-5 space-y-6 pb-40">

            {/* Active Stoppage Banner */}
            {hasActiveStoppage && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl px-5 py-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                <p className="font-bold text-amber-800 text-sm">Machine currently in stoppage mode. Resolve before handover if possible.</p>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 1 — Shift Summary (LOCKED) */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <SectionHeader icon={<Clock className="h-4 w-4" />} title="Shift Summary" locked />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <LockedField label="Date" value={p.shift.prodDate} />
                <LockedField label="Shift" value={p.shift.shiftCode} />
                <LockedField label="Machine" value={p.machineName} />
                <LockedField label="Process" value={p.processCode} />
                <LockedField label="Scheduled Shift Start" value={scheduledShiftStart} />
                <LockedField label="Scheduled Shift End" value={scheduledShiftEnd} />
                <LockedField label="Actual Session Start" value={actualSessionStart} />
                <LockedField label="Next Shift" value={p.nextShift.shiftCode} />
                <LockedField label="Next Shift Date" value={p.nextShift.prodDate} />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 2 — Production Summary (AUTO) */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <SectionHeader icon={<BarChart2 className="h-4 w-4" />} title="Production Summary" badge="Auto-calculated from shift log" locked />
              {prod ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
                    <p className="text-xl font-black text-emerald-700">{prod.totalProdMt.toFixed(3)}</p>
                    <p className="text-[10px] font-bold uppercase text-emerald-500">Total MT</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-3 text-center">
                    <p className="text-xl font-black text-foreground">{prod.completedOrderCount}</p>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Completed</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-3 text-center">
                    <p className="text-xl font-black text-foreground">{prod.inProgressOrderCount}</p>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Running</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
                    <p className="text-xl font-black text-emerald-700">{prod.machineUtilizationPct}%</p>
                    <p className="text-[10px] font-bold uppercase text-emerald-500">Runtime Utilization</p>
                  </div>
                  <LockedField label="Total Stoppage" value={formatMin(prod.totalStoppageMinutes)} />
                  <LockedField label="Total Breakdown" value={formatMin(prod.totalBreakdownMinutes)} />
                  <LockedField label="Rolling MT" value={`${prod.totalRollingMt.toFixed(3)} MT`} />
                  <LockedField label="Skin Pass MT" value={`${prod.totalSkinpassMt.toFixed(3)} MT`} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No shift log data available for this session</p>
              )}
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 3 — Manual Shift Fields */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <SectionHeader icon={<Edit3 className="h-4 w-4" />} title="Shift Data Entry" badge="Operator fills" />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ManualField label="Scrap (Kg)">
                  <input
                    type="number"
                    className={inputClass()}
                    value={scrapKg}
                    onChange={(e) => setScrapKg(e.target.value)}
                    placeholder="0.0"
                    inputMode="decimal"
                    id="handover-scrap-kg"
                  />
                </ManualField>
                <ManualField label="Coolant Temp (°C)">
                  <input
                    type="number"
                    className={inputClass()}
                    value={coolantTemp}
                    onChange={(e) => setCoolantTemp(e.target.value)}
                    placeholder="e.g. 38"
                    inputMode="decimal"
                    id="handover-coolant-temp"
                  />
                </ManualField>
                <ManualField label="Coolant Pressure (Kg/cm²)">
                  <input
                    type="number"
                    className={inputClass()}
                    value={coolantPress}
                    onChange={(e) => setCoolantPress(e.target.value)}
                    placeholder="e.g. 4.5"
                    inputMode="decimal"
                    id="handover-coolant-press"
                  />
                </ManualField>
                <div className="col-span-2 md:col-span-3">
                  <ManualField label="Shift Remarks">
                    <textarea
                      className={inputClass()}
                      value={shiftRemarks}
                      onChange={(e) => setShiftRemarks(e.target.value)}
                      rows={2}
                      placeholder="General shift observations…"
                      id="handover-shift-remarks"
                    />
                  </ManualField>
                </div>
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 4 — Current Running Order (LOCKED, only if active) */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeOrder ? (
              <div className="bg-white border-2 border-emerald-300 rounded-2xl overflow-hidden">
                <div className="bg-emerald-500 px-5 py-3 flex items-center gap-2">
                  <Package className="h-4 w-4 text-white" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Current Running Order</h2>
                  <Lock className="h-3.5 w-3.5 text-emerald-200 ml-auto" />
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <LockedField label="Batch Number" value={activeOrder.batchNumber} />
                    <LockedField label="Customer" value={activeOrder.customer} />
                    <LockedField label="Grade" value={activeOrder.grade} />
                    <LockedField label="Process" value={activeOrder.subProcess?.replace(/_/g, ' ')} />
                    <LockedField label="Start Time" value={activeOrder.startTime ? formatPlantClock(activeOrder.startTime) : undefined} />
                    <LockedField label="Runtime" value={runtimeTimer} />
                    <LockedField label="Produced" value={activeOrder.producedWeightMt != null ? `${activeOrder.producedWeightMt} MT` : undefined} />
                    <LockedField label="Remaining" value={activeOrder.remainingWeightMt != null ? `${activeOrder.remainingWeightMt.toFixed(3)} MT` : undefined} />
                    <LockedField label="Target Weight" value={`${activeOrder.targetWeightMt ?? 0} MT`} />
                    <LockedField label="Target Thickness" value={activeOrder.targetThkMm ? `${activeOrder.targetThkMm} mm` : undefined} />
                    <LockedField label="Destination" value={activeOrder.destinationProcess ?? '—'} />
                    <LockedField label="Pass No" value={activeOrder.currentPassNo} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground font-medium">Progress</span>
                      <span className="font-bold text-foreground">{activeOrder.progressPct ?? 0}%</span>
                    </div>
                    <ProgressBar pct={activeOrder.progressPct ?? 0} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-secondary/40 border border-border rounded-2xl p-5 text-center">
                <p className="text-sm text-muted-foreground">No active order — machine is idle</p>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 5 — Order Snapshot (operator fills) */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeOrder && (
              <div className="bg-white border border-border rounded-2xl p-5">
                <SectionHeader icon={<Zap className="h-4 w-4" />} title="Current Order Snapshot" badge="Operator fills — incoming operator will see this" />
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <ManualField label="Production Stage">
                    <input
                      type="text"
                      className={inputClass()}
                      value={orderSnapshot.currentStage ?? ''}
                      onChange={(e) => setOrderSnapshot((s) => ({ ...s, currentStage: e.target.value }))}
                      placeholder="e.g. In rolling pass 3"
                      id="handover-stage"
                    />
                  </ManualField>
                  <ManualField label="Current Pass No">
                    <input
                      type="number"
                      className={inputClass()}
                      value={orderSnapshot.currentPassNumber ?? ''}
                      onChange={(e) => setOrderSnapshot((s) => ({ ...s, currentPassNumber: Number(e.target.value) }))}
                      placeholder="e.g. 4"
                      id="handover-pass-no"
                    />
                  </ManualField>
                  <ManualField label="Current Thickness (mm)">
                    <input
                      type="number"
                      className={inputClass()}
                      value={orderSnapshot.currentThicknessMm ?? ''}
                      onChange={(e) => setOrderSnapshot((s) => ({ ...s, currentThicknessMm: Number(e.target.value) }))}
                      placeholder="e.g. 0.72"
                      inputMode="decimal"
                      id="handover-current-thk"
                    />
                  </ManualField>
                  <ManualField label="Target Thickness (mm)">
                    <input
                      type="number"
                      className={inputClass()}
                      value={orderSnapshot.targetThicknessMm ?? activeOrder.targetThkMm ?? ''}
                      onChange={(e) => setOrderSnapshot((s) => ({ ...s, targetThicknessMm: Number(e.target.value) }))}
                      placeholder="e.g. 0.65"
                      inputMode="decimal"
                      id="handover-target-thk"
                    />
                  </ManualField>
                  <div className="col-span-2">
                    <ManualField label="Next Action Required">
                      <input
                        type="text"
                        className={inputClass()}
                        value={orderSnapshot.nextActionRequired ?? ''}
                        onChange={(e) => setOrderSnapshot((s) => ({ ...s, nextActionRequired: e.target.value }))}
                        placeholder="e.g. Continue rolling to 0.65mm, then dispatch to annealing"
                        id="handover-next-action"
                      />
                    </ManualField>
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <ManualField label="Order Remarks">
                      <textarea
                        className={inputClass()}
                        value={orderSnapshot.orderRemarks ?? ''}
                        onChange={(e) => setOrderSnapshot((s) => ({ ...s, orderRemarks: e.target.value }))}
                        rows={2}
                        placeholder="Any special notes about this coil or order…"
                        id="handover-order-remarks"
                      />
                    </ManualField>
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 6 — Machine Condition */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <SectionHeader icon={<Wrench className="h-4 w-4" />} title="Machine Condition" />
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">Machine Status</p>
                  <div className="flex flex-wrap gap-2">
                    {MACHINE_STATUSES.map((s) => (
                      <ToggleChip
                        key={s}
                        value={s}
                        active={machineStatus === s}
                        onClick={() => setMachineStatus(s)}
                        colorClass={STATUS_COLORS[s]}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">Machine Condition</p>
                  <div className="flex flex-wrap gap-2">
                    {MACHINE_CONDITIONS.map((c) => (
                      <ToggleChip
                        key={c}
                        value={c}
                        active={machineCondition === c}
                        onClick={() => setMachineCondition(c)}
                        colorClass={CONDITION_COLORS[c]}
                      />
                    ))}
                  </div>
                </div>
                <ManualField label="Condition Remarks">
                  <textarea
                    className={inputClass()}
                    value={conditionRemarks}
                    onChange={(e) => setConditionRemarks(e.target.value)}
                    rows={2}
                    placeholder="Describe any issues, vibrations, or observations…"
                    id="handover-condition-remarks"
                  />
                </ManualField>
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 7 — Open Stoppages (LOCKED) */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <SectionHeader icon={<AlertCircle className="h-4 w-4" />} title="Open Stoppages" locked />
              {openStoppages.length === 0 ? (
                <div className="flex items-center gap-2 py-4">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <p className="text-sm text-muted-foreground">No open stoppages</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {openStoppages.map((s, i) => (
                    <div key={i} className="py-3 flex items-center justify-between text-sm">
                      <div>
                        <p className="font-semibold text-amber-800">{s.reason ?? 'Unknown reason'}</p>
                        <p className="text-xs text-muted-foreground">{formatPlantClock(s.startAt)}</p>
                      </div>
                      <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">OPEN</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 8 — Next Orders in Queue (LOCKED) */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <div 
                className="flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity" 
                onClick={() => setQueueExpanded(!queueExpanded)}
              >
                <div className="flex-1">
                  <SectionHeader icon={queueExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} title="Next Orders in Queue" badge="Incoming operator reference" locked />
                </div>
                <div className="text-sm font-medium text-muted-foreground mb-4">
                  {allQueueItems.length} orders
                </div>
              </div>
              
              {queueExpanded && (
                allQueueItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center border-t border-border/50 mt-2">Queue is empty</p>
                ) : (
                  <div className="space-y-2 border-t border-border/50 pt-4 mt-2">
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
                )
              )}
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 9 — Crew Details */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <SectionHeader icon={<Users className="h-4 w-4" />} title="Crew Details" badge="From machine crew roster" />
              {crewRoster.length > 0 ? (
                <div className="mb-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Select crew on shift (tap to add/remove)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {crewRoster.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleRosterMember(member)}
                        className={[
                          'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                          selectedRosterIds.has(member.id)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-secondary text-foreground border-border hover:bg-muted',
                        ].join(' ')}
                      >
                        {member.memberName} · {member.roleLabel}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mb-3">
                  No crew roster for this machine. Add members in Machine Head → Crew Management.
                </p>
              )}
              {p.crewSnapshot && p.crewSnapshot.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Shift log crew</p>
                  {p.crewSnapshot.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 bg-secondary/30 rounded-xl px-4 py-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-black flex items-center justify-center">{c.operatorName[0]}</div>
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-foreground">{c.operatorName}</p>
                        <p className="text-xs text-muted-foreground">{c.empCode} · {c.roleCode}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <ManualField label="Crew Notes / Updates">
                <textarea
                  className={inputClass()}
                  value={crewNotes}
                  onChange={(e) => setCrewNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Helper: Ramesh, Crane Op: Suresh — or any changes from loaded crew"
                  id="handover-crew-notes"
                />
              </ManualField>
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* SECTION 10 — Handover Priority + Outgoing Notes (MANDATORY) */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border-2 border-primary/20 rounded-2xl p-5">
              <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Outgoing Operator Notes" badge="MANDATORY — incoming operator will read this first" />

              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">Handover Priority</p>
                <div className="flex flex-wrap gap-2">
                  {PRIORITIES.map((p) => (
                    <ToggleChip
                      key={p}
                      value={p}
                      active={priority === p}
                      onClick={() => setPriority(p)}
                      colorClass={PRIORITY_COLORS[p]}
                    />
                  ))}
                </div>
              </div>

              <ManualField label="Handover Notes" required>
                <textarea
                  id="handover-outgoing-notes"
                  className={`${inputClass(!!notesError)} min-h-[160px] resize-y`}
                  value={outgoingNotes}
                  onChange={(e) => {
                    setOutgoingNotes(e.target.value);
                    if (e.target.value.trim().length >= MIN_NOTES_LENGTH) setNotesError('');
                  }}
                  rows={6}
                  placeholder="Describe the machine condition, any open issues, what needs attention, what was completed, next steps for the incoming operator…

Examples:
• Machine vibration observed on work roll — monitor
• Roll change completed, new roll in good condition  
• Order B-2045 needs 2 more passes to complete
• Coolant pressure dropped, maintenance notified
• Dispatch for B-2041 pending from quality team"
                />
                <div className="flex justify-between items-center mt-1.5 px-1">
                  {notesError ? (
                    <p className="text-xs text-destructive font-medium">{notesError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Min {MIN_NOTES_LENGTH} characters</p>
                  )}
                  <p className={`text-xs font-mono font-bold ${outgoingNotes.trim().length >= MIN_NOTES_LENGTH ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {outgoingNotes.trim().length} / {MIN_NOTES_LENGTH}+
                  </p>
                </div>
              </ManualField>
            </div>

            {/* Error */}
            {submitError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-2xl px-5 py-4 flex gap-3 items-start">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-destructive text-sm font-medium">{submitError}</p>
              </div>
            )}

          </div>
        </div>

        {/* ── STICKY FOOTER ── */}
        <div className="shrink-0 bg-white border-t border-border/60 px-5 py-4 flex gap-3">
          <ZButton
            variant="secondary"
            size="lg"
            className="min-h-[52px] flex-1"
            disabled={saving || submitting}
            onClick={saveDraft}
          >
            {saving ? 'Saving…' : draftId ? '✓ Draft Saved' : 'Save Draft'}
          </ZButton>
          <ZButton
            variant="accent"
            size="lg"
            className="min-h-[52px] flex-[2]"
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? 'Submitting…' : 'Submit Handover & Sign Out'}
          </ZButton>
          <ZButton
            variant="ghost"
            size="lg"
            className="min-h-[52px]"
            onClick={() => navigate(basePath)}
          >
            Cancel
          </ZButton>
        </div>
      </div>
  );
}
