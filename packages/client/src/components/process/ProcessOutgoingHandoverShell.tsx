import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Lock, Users } from 'lucide-react';
import { useAuthStore } from '../../lib/authStore';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useHandoverDraft, useHandoverPreview } from '../../hooks/useHandoverState';
import { machineHandoverService, type HandoverPreview, type PendingHandover } from '../../services/machineHandoverService';
import { ZButton } from '../primitives/ZButton';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { machineCrewService, type MachineCrewMember } from '../../lib/machineCrewService';
import { useManualDraft } from '../../lib/useFormDraft';

export const HANDOVER_MIN_NOTES = 20;
export const HANDOVER_AUTO_SAVE_MS = 30_000;
export const HANDOVER_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type HandoverPriority = (typeof HANDOVER_PRIORITIES)[number];

export function HandoverSectionHeader({
  icon, title, badge, locked,
}: {
  icon: ReactNode; title: string; badge?: string; locked?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-secondary text-muted-foreground shrink-0">{icon}</div>
      <div className="flex-1">
        <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">{title}</h2>
        {badge && <span className="text-[10px] text-muted-foreground">{badge}</span>}
      </div>
      {locked && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
          <Lock className="h-3 w-3" /> AUTO
        </div>
      )}
    </div>
  );
}

export function HandoverLockedField({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
      <p className="font-semibold text-foreground text-sm font-mono">{value ?? '—'}</p>
    </div>
  );
}

type ShellProps = {
  machineCode: string;
  title: string;
  loadingLabel?: string;
  children: ReactNode;
  /** Extra fields merged into draft/submit payload (e.g. ANN shiftRemarks). */
  extraPayload?: Record<string, unknown>;
  hydrateExtra?: (draft: PendingHandover | null | undefined, preview: HandoverPreview | null | undefined) => void;
  footerLabels?: { save?: string; submit?: string };
  onRetry?: () => void;
  /** Optional field(s) rendered above outgoing notes (e.g. ANN shift remarks). */
  notesExtra?: ReactNode;
};

/** Shared outgoing-handover chrome: preview/draft/autosave/crew/notes/submit. Line bodies via children. */
export function ProcessOutgoingHandoverShell({
  machineCode,
  title,
  loadingLabel,
  children,
  extraPayload,
  hydrateExtra,
  footerLabels,
  onRetry,
  notesExtra,
}: ShellProps) {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const { logout } = useAuthStore();

  const {
    data: preview,
    error: previewError,
    isLoading: previewLoading,
    mutate: mutatePreview,
  } = useHandoverPreview(machineCode);
  const {
    data: draft,
    error: draftErrorSwr,
    isLoading: draftLoading,
    mutate: mutateDraft,
  } = useHandoverDraft(machineCode);
  const hydratedKey = useRef<string | null>(null);

  const [crewNotes, setCrewNotes] = useState('');
  const [crewRoster, setCrewRoster] = useState<MachineCrewMember[]>([]);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());
  const [outgoingNotes, setOutgoingNotes] = useState('');
  const [notesError, setNotesError] = useState('');
  const [priority, setPriority] = useState<HandoverPriority>('MEDIUM');
  const [machineStatus, setMachineStatus] = useState('IDLE');
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loading = (previewLoading || draftLoading) && !preview && !previewError && !draftErrorSwr;
  const loadError = previewError || draftErrorSwr
    ? (previewError instanceof Error ? previewError.message : null)
      ?? (draftErrorSwr instanceof Error ? draftErrorSwr.message : null)
      ?? 'Failed to load'
    : null;

  useEffect(() => {
    if (!preview && !draft) return;
    const key = `${machineCode}:${draft?.handover_id ?? 'nodraft'}`;
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;
    if (preview?.machineStatus) setMachineStatus(preview.machineStatus);
    if (draft) {
      const ps = draft.production_snapshot as Record<string, unknown>;
      if (ps?.crewNotes) setCrewNotes(String(ps.crewNotes));
      setOutgoingNotes(draft.remarks ?? '');
      if (draft.handover_priority) setPriority(draft.handover_priority as HandoverPriority);
      if (draft.machine_status) setMachineStatus(draft.machine_status);
    }
    hydrateExtra?.(draft, preview);

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
  }, [preview, draft, machineCode, hydrateExtra]);

  useEffect(() => {
    if (preview?.machineCrewRoster?.length) {
      setCrewRoster(preview.machineCrewRoster.map((c) => ({
        id: c.id,
        machineCode: preview.machineCode,
        memberName: c.memberName,
        roleLabel: c.roleLabel,
      })));
      return;
    }
    void machineCrewService.list(machineCode)
      .then((res) => setCrewRoster(res.crew ?? []))
      .catch(() => setCrewRoster([]));
  }, [machineCode, preview?.machineCode, preview?.machineCrewRoster]);

  function toggleCrew(member: MachineCrewMember) {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(member.id)) next.delete(member.id);
      else next.add(member.id);
      setCrewNotes(crewRoster.filter((c) => next.has(c.id)).map((c) => `${c.memberName} (${c.roleLabel})`).join(', '));
      return next;
    });
  }

  const buildPayload = useCallback(() => ({
    machineStatus,
    machineCondition: 'NORMAL',
    remarks: outgoingNotes,
    handoverPriority: priority,
    crewNotes: crewNotes || undefined,
    selectedCrewIds: selectedRosterIds.size ? [...selectedRosterIds] : undefined,
    ...extraPayload,
  }), [machineStatus, outgoingNotes, priority, crewNotes, selectedRosterIds, extraPayload]);

  const saveDraft = useCallback(async () => {
    if (!preview) return;
    setSaving(true);
    setDraftError(null);
    try {
      await machineHandoverService.saveDraft(machineCode, buildPayload());
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
  }, [preview, buildPayload, machineCode]);

  useEffect(() => {
    if (!preview) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(saveDraft, HANDOVER_AUTO_SAVE_MS);
    return () => clearTimeout(autoSaveRef.current);
  }, [saveDraft, preview]);

  const { clearDraft } = useManualDraft(
    buildPayload(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCallback((parsed: any) => {
      if (parsed.machineStatus) setMachineStatus(parsed.machineStatus);
      if (parsed.remarks) setOutgoingNotes(parsed.remarks);
      if (parsed.handoverPriority) setPriority(parsed.handoverPriority);
      if (parsed.crewNotes) setCrewNotes(parsed.crewNotes);
    }, []),
    `handover_${machineCode}`,
  );

  async function submit() {
    if (outgoingNotes.trim().length < HANDOVER_MIN_NOTES) {
      setNotesError(`Please enter at least ${HANDOVER_MIN_NOTES} characters`);
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
        <p className="text-sm text-muted-foreground">{loadingLabel ?? `Loading ${title} handover…`}</p>
      </div>
    );
  }

  const p = preview ?? {
    machineCode,
    shift: {
      shiftCode: '—', shiftName: '—', prodDate: '—',
      windowStart: undefined as string | undefined,
      windowEnd: undefined as string | undefined,
      actualSessionStartAt: undefined as string | undefined,
    },
    nextShift: { shiftCode: '—', prodDate: '—' },
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {loadError && (
        <div className="shrink-0 px-5 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">{loadError}</span>
          </span>
          {(onRetry || loadError) && (
            <ZButton
              variant="secondary"
              className="shrink-0 min-h-9 px-3 text-xs"
              onClick={() => {
                hydratedKey.current = null;
                onRetry?.();
                void mutatePreview();
                void mutateDraft();
              }}
            >
              Retry
            </ZButton>
          )}
        </div>
      )}

      <div className="shrink-0 px-5 py-4 border-b border-border bg-card flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Outgoing Handover</p>
          <h1 className="text-lg font-bold">{title} · Shift {p.shift.shiftCode}</h1>
          <p className="text-xs text-muted-foreground font-mono">
            {p.shift.prodDate} · {p.shift.windowStart ? formatPlantDateTime(p.shift.windowStart) : '—'}
            {' → '}
            {p.shift.windowEnd ? formatPlantDateTime(p.shift.windowEnd) : '—'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {draftSaved && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Draft saved
            </span>
          )}
          {draftError && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {draftError}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
        {children}

        <section className="rounded-xl border border-border bg-card p-5">
          <HandoverSectionHeader icon={<Users className="h-4 w-4" />} title="Crew Details" />
          <div className="flex flex-wrap gap-2 mb-3">
            {crewRoster.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleCrew(m)}
                className={[
                  'min-h-11 px-3 rounded-xl border text-sm font-medium',
                  selectedRosterIds.has(m.id) ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground',
                ].join(' ')}
              >
                {m.memberName} · {m.roleLabel}
              </button>
            ))}
            {crewRoster.length === 0 && <p className="text-sm text-muted-foreground">No roster configured</p>}
          </div>
          <textarea
            className="w-full min-h-[44px] rounded-xl border border-input bg-background px-4 py-2.5 text-sm"
            value={crewNotes}
            onChange={(e) => setCrewNotes(e.target.value)}
            placeholder="Crew notes"
          />
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <HandoverSectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Outgoing Notes" />
          {notesExtra}
          <div className="flex gap-2 mb-3">
            {HANDOVER_PRIORITIES.map((pr) => (
              <button
                key={pr}
                type="button"
                onClick={() => setPriority(pr)}
                className={[
                  'min-h-11 px-4 rounded-xl border-2 text-sm font-bold',
                  priority === pr ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground',
                ].join(' ')}
              >
                {pr}
              </button>
            ))}
          </div>
          <textarea
            className={`w-full min-h-[120px] rounded-xl border px-4 py-2.5 text-sm ${notesError ? 'border-destructive' : 'border-input'}`}
            value={outgoingNotes}
            onChange={(e) => { setOutgoingNotes(e.target.value); setNotesError(''); }}
            placeholder={`Outgoing operator notes (min ${HANDOVER_MIN_NOTES} chars) *`}
          />
          {notesError && <p className="text-destructive text-sm mt-1">{notesError}</p>}
        </section>

        {submitError && <p className="text-destructive text-sm">{submitError}</p>}
      </div>

      <div className="shrink-0 border-t border-border bg-card px-5 py-4 flex gap-3 justify-end">
        {basePath && (
          <ZButton type="button" variant="ghost" onClick={() => navigate(basePath)}>Cancel</ZButton>
        )}
        <ZButton type="button" variant="secondary" onClick={() => void saveDraft()} disabled={saving || submitting}>
          {saving ? 'Saving…' : (footerLabels?.save ?? 'Save Draft')}
        </ZButton>
        <ZButton type="button" onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Submitting…' : (footerLabels?.submit ?? 'Submit & End Shift')}
        </ZButton>
      </div>
    </div>
  );
}
