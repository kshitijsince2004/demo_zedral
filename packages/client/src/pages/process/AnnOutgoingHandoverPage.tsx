import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Lock, Users } from 'lucide-react';
import { useAuthStore } from '../../lib/authStore';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useHandoverDraft, useHandoverPreview } from '../../hooks/useHandoverState';
import { machineHandoverService } from '../../services/machineHandoverService';
import { AnnShiftReviewPanel } from '../../components/process/AnnShiftReviewPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { machineCrewService, type MachineCrewMember } from '../../lib/machineCrewService';
import { useManualDraft } from '../../lib/useFormDraft';
import { useShiftStore } from '../../store/shiftStore';

const MACHINE_CODE = 'ANN';
const MIN_NOTES_LENGTH = 20;
const AUTO_SAVE_MS = 30_000;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
type Priority = (typeof PRIORITIES)[number];

const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: 'bg-slate-100 text-slate-600 border-slate-300',
  MEDIUM: 'bg-blue-100 text-blue-700 border-blue-300',
  HIGH: 'bg-amber-100 text-amber-700 border-amber-300',
};

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
      {value}
    </button>
  );
}

/** ANN-only outgoing handover — Summary + AnnShiftReview + Crew/Notes/Submit. */
export function AnnOutgoingHandoverPage() {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const { logout } = useAuthStore();
  const annShiftLogId = useShiftStore((s) => s.shiftLogId);

  const {
    data: preview,
    error: previewError,
    isLoading: previewLoading,
    mutate: mutatePreview,
  } = useHandoverPreview(MACHINE_CODE);
  const {
    data: draft,
    error: draftErrorSwr,
    isLoading: draftLoading,
    mutate: mutateDraft,
  } = useHandoverDraft(MACHINE_CODE);
  const hydratedKey = useRef<string | null>(null);

  const [crewNotes, setCrewNotes] = useState('');
  const [crewRoster, setCrewRoster] = useState<MachineCrewMember[]>([]);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());
  const [outgoingNotes, setOutgoingNotes] = useState('');
  const [annRemarks, setAnnRemarks] = useState('');
  const [notesError, setNotesError] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [machineStatus, setMachineStatus] = useState('IDLE');
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loading = (previewLoading || draftLoading) && !preview && !previewError && !draftErrorSwr;
  const loadError = previewError || draftErrorSwr
    ? (previewError instanceof Error ? previewError.message : null)
      ?? (draftErrorSwr instanceof Error ? draftErrorSwr.message : null)
      ?? 'Failed to load enrichment'
    : null;

  useEffect(() => {
    if (!preview && !draft) return;
    const key = `${MACHINE_CODE}:${preview ? 'p' : ''}:${draft?.handover_id ?? 'nodraft'}`;
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;

    if (preview?.machineStatus) setMachineStatus(preview.machineStatus);

    if (draft) {
      setDraftId(draft.handover_id);
      const ps = draft.production_snapshot as Record<string, unknown>;
      const sm = ps?.shiftManualFields as Record<string, unknown> | null;
      if (ps?.crewNotes) setCrewNotes(String(ps.crewNotes));
      if (sm?.shiftRemarks != null) setAnnRemarks(String(sm.shiftRemarks ?? ''));
      setOutgoingNotes(draft.remarks ?? '');
      if (draft.handover_priority) setPriority(draft.handover_priority as Priority);
      if (draft.machine_status) setMachineStatus(draft.machine_status);
    }

    const roster = preview?.machineCrewRoster ?? [];
    const crewSnap = preview?.crewSnapshot ?? [];
    if (crewSnap.length && roster.length) {
      const ids = new Set<string>();
      for (const crew of crewSnap) {
        const crewId = String(crew.crewId ?? crew.id ?? '').trim();
        if (crewId && roster.some((r) => r.id === crewId)) {
          ids.add(crewId);
          continue;
        }
        const name = String(crew.operatorName ?? crew.memberName ?? '').trim().toLowerCase();
        const role = String(crew.roleCode ?? crew.roleLabel ?? '').trim().toLowerCase();
        const match = roster.find((r) => {
          const rn = r.memberName.trim().toLowerCase();
          const rr = r.roleLabel.trim().toLowerCase();
          return (name && rn === name) || (name && role && rn === name && rr === role);
        });
        if (match) ids.add(match.id);
      }
      if (ids.size) {
        setSelectedRosterIds(ids);
        setCrewNotes(
          roster.filter((r) => ids.has(r.id)).map((r) => `${r.memberName} (${r.roleLabel})`).join(', '),
        );
      }
    }
  }, [preview, draft]);

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
      .list(MACHINE_CODE)
      .then((res) => setCrewRoster(res.crew))
      .catch(() => setCrewRoster([]));
  }, [preview?.machineCode, preview?.machineCrewRoster]);

  function toggleRosterMember(member: MachineCrewMember) {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(member.id)) next.delete(member.id);
      else next.add(member.id);
      const selected = crewRoster.filter((c) => next.has(c.id));
      setCrewNotes(selected.map((c) => `${c.memberName} (${c.roleLabel})`).join(', '));
      return next;
    });
  }

  const buildPayload = useCallback(() => ({
    machineStatus,
    machineCondition: 'NORMAL',
    remarks: outgoingNotes,
    handoverPriority: priority,
    shiftRemarks: annRemarks || undefined,
    crewNotes: crewNotes || undefined,
    selectedCrewIds: selectedRosterIds.size ? [...selectedRosterIds] : undefined,
  }), [machineStatus, outgoingNotes, priority, annRemarks, crewNotes, selectedRosterIds]);

  const saveDraft = useCallback(async () => {
    if (!preview) return;
    setSaving(true);
    setDraftError(null);
    try {
      const saved = await machineHandoverService.saveDraft(MACHINE_CODE, buildPayload());
      setDraftId(saved.handover_id);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (e: unknown) {
      const err = e as { status?: number };
      setDraftError(err?.status === 403
        ? 'Access Denied: Please re-login to refresh permissions'
        : 'Draft failed to save on server');
    } finally {
      setSaving(false);
    }
  }, [preview, buildPayload]);

  useEffect(() => {
    if (!preview) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(saveDraft, AUTO_SAVE_MS);
    return () => clearTimeout(autoSaveRef.current);
  }, [saveDraft, preview]);

  const draftValues = useMemo(() => buildPayload(), [buildPayload]);
  const { clearDraft } = useManualDraft(
    draftValues,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCallback((parsed: any) => {
      if (parsed.machineStatus) setMachineStatus(parsed.machineStatus);
      if (parsed.remarks) setOutgoingNotes(parsed.remarks);
      if (parsed.handoverPriority) setPriority(parsed.handoverPriority);
      if (parsed.shiftRemarks) setAnnRemarks(String(parsed.shiftRemarks));
      if (parsed.crewNotes) setCrewNotes(parsed.crewNotes);
      if (parsed.selectedCrewIds && !(preview?.crewSnapshot?.length)) {
        setSelectedRosterIds(new Set(parsed.selectedCrewIds));
      }
    }, [preview?.crewSnapshot?.length]),
    `handover_${MACHINE_CODE}`,
  );

  async function submit() {
    if (outgoingNotes.trim().length < MIN_NOTES_LENGTH) {
      setNotesError(`Please enter at least ${MIN_NOTES_LENGTH} characters`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await machineHandoverService.submitOutgoing(MACHINE_CODE, {
        ...buildPayload(),
        remarks: outgoingNotes.trim(),
      });
      clearDraft();
      const { notifyProductionChanged } = await import('../../lib/productionSync');
      notifyProductionChanged();
      await logout();
      navigate('/login', { replace: true });
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Handover submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading ANN handover…</p>
        </div>
      </div>
    );
  }

  const emptyPreview = {
    machineCode: MACHINE_CODE,
    machineName: 'Annealing',
    processCode: MACHINE_CODE,
    machineStatus: machineStatus || 'IDLE',
    shift: { shiftCode: '—', shiftName: '—', prodDate: '—', windowStart: undefined as string | undefined, windowEnd: undefined as string | undefined, actualSessionStartAt: undefined as string | undefined },
    nextShift: { shiftCode: '—', prodDate: '—' },
    crewSnapshot: [] as Array<Record<string, string>>,
  };
  const p = preview ?? emptyPreview;
  const scheduledShiftStart = p.shift.windowStart ?? '—';
  const scheduledShiftEnd = p.shift.windowEnd ?? '—';
  const actualSessionStart = p.shift.actualSessionStartAt
    ? formatPlantDateTime(p.shift.actualSessionStartAt)
    : '—';

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {loadError && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive">
          <span className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">{loadError} — form stays editable; Retry to reload.</span>
          </span>
          <ZButton
            variant="secondary"
            className="shrink-0 min-h-9 px-3 text-xs"
            onClick={() => {
              hydratedKey.current = null;
              void mutatePreview();
              void mutateDraft();
            }}
          >
            Retry
          </ZButton>
        </div>
      )}

      <div className="shrink-0 bg-white border-b border-border/60 px-5 py-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-0.5">End Shift · ANN Handover</p>
            <h1 className="text-2xl font-black text-foreground">{p.machineName ?? 'Annealing'}</h1>
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-4xl mx-auto p-5 space-y-6 pb-40">
          <div className="bg-white border border-border rounded-2xl p-5">
            <SectionHeader icon={<Clock className="h-4 w-4" />} title="Shift Summary" locked />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <LockedField label="Date" value={p.shift.prodDate} />
              <LockedField label="Shift" value={p.shift.shiftCode} />
              <LockedField label="Machine" value={p.machineName ?? 'Annealing'} />
              <LockedField label="Process" value={p.processCode ?? MACHINE_CODE} />
              <LockedField label="Scheduled Shift Start" value={scheduledShiftStart} />
              <LockedField label="Scheduled Shift End" value={scheduledShiftEnd} />
              <LockedField label="Actual Session Start" value={actualSessionStart} />
              <LockedField label="Next Shift" value={p.nextShift.shiftCode} />
              <LockedField label="Next Shift Date" value={p.nextShift.prodDate} />
            </div>
          </div>

          <AnnShiftReviewPanel
            shiftLogId={annShiftLogId}
            remarks={annRemarks}
            onRemarksChange={setAnnRemarks}
          />

          <div className="bg-white border border-border rounded-2xl p-5">
            <SectionHeader icon={<Users className="h-4 w-4" />} title="Crew Details" badge="Loaded from session crew · editable" />
            {crewRoster.length > 0 ? (
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Crew on this shift
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
                No crew roster for ANN. Add members in Machine Head → Crew.
              </p>
            )}
            <ManualField label="Crew Notes / Updates">
              <textarea
                className={inputClass()}
                value={crewNotes}
                onChange={(e) => setCrewNotes(e.target.value)}
                rows={2}
                placeholder="Crew updates for incoming operator…"
              />
            </ManualField>
          </div>

          <div className="bg-white border-2 border-primary/20 rounded-2xl p-5">
            <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Outgoing Operator Notes" badge="MANDATORY" />
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">Handover Priority</p>
              <div className="flex flex-wrap gap-2">
                {PRIORITIES.map((pr) => (
                  <ToggleChip
                    key={pr}
                    value={pr}
                    active={priority === pr}
                    onClick={() => setPriority(pr)}
                    colorClass={PRIORITY_COLORS[pr]}
                  />
                ))}
              </div>
            </div>
            <ManualField label="Handover Notes" required>
              <textarea
                className={`${inputClass(!!notesError)} min-h-[160px] resize-y`}
                value={outgoingNotes}
                onChange={(e) => {
                  setOutgoingNotes(e.target.value);
                  if (e.target.value.trim().length >= MIN_NOTES_LENGTH) setNotesError('');
                }}
                rows={6}
                placeholder="Bases / charges needing attention, open stoppages, dew or unload notes, next steps for incoming operator…"
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

          {submitError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-2xl px-5 py-4 flex gap-3 items-start">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-destructive text-sm font-medium">{submitError}</p>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-white border-t border-border/60 px-5 py-4 flex gap-3">
        <ZButton variant="secondary" size="lg" className="min-h-[52px] flex-1" disabled={saving || submitting} onClick={() => void saveDraft()}>
          {saving ? 'Saving…' : draftId ? '✓ Draft Saved' : 'Save Draft'}
        </ZButton>
        <ZButton variant="accent" size="lg" className="min-h-[52px] flex-[2]" disabled={submitting} onClick={() => void submit()}>
          {submitting ? 'Submitting…' : 'Submit Handover & Sign Out'}
        </ZButton>
        <ZButton variant="ghost" size="lg" className="min-h-[52px]" onClick={() => navigate(basePath || '/')}>
          Cancel
        </ZButton>
      </div>
    </div>
  );
}
