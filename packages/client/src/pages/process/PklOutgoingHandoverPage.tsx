import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, FlaskConical, Lock, Users } from 'lucide-react';
import { useAuthStore } from '../../lib/authStore';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useHandoverDraft, useHandoverPreview } from '../../hooks/useHandoverState';
import { machineHandoverService } from '../../services/machineHandoverService';
import { ZButton } from '../../components/primitives/ZButton';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { machineCrewService, type MachineCrewMember } from '../../lib/machineCrewService';
import { useManualDraft } from '../../lib/useFormDraft';
import { useShiftStore } from '../../store/shiftStore';
import { apiClient } from '../../lib/apiClient';
import { useProcessStore } from '../../store/processStore';

const MACHINE_CODE = 'PKL';
const MIN_NOTES_LENGTH = 20;
const AUTO_SAVE_MS = 30_000;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
type Priority = (typeof PRIORITIES)[number];

function SectionHeader({ icon, title, locked }: { icon: React.ReactNode; title: string; locked?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-secondary text-muted-foreground shrink-0">{icon}</div>
      <h2 className="flex-1 text-sm font-bold uppercase tracking-widest text-foreground">{title}</h2>
      {locked && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
          <Lock className="h-3 w-3" /> AUTO
        </div>
      )}
    </div>
  );
}

function LockedField({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
      <p className="font-semibold text-foreground text-sm font-mono">{value ?? '—'}</p>
    </div>
  );
}

/** PKL outgoing handover — production / crew / stoppages / next coils / chart / notes (revamp §7). */
export function PklOutgoingHandoverPage() {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const { logout } = useAuthStore();
  const shiftLogId = useShiftStore((s) => s.shiftLogId);
  const queue = useProcessStore((s) => s.queue);
  const loadQueue = useProcessStore((s) => s.loadQueue);

  const { data: preview, error: previewError, isLoading: previewLoading } = useHandoverPreview(MACHINE_CODE);
  const { data: draft, error: draftErrorSwr, isLoading: draftLoading } = useHandoverDraft(MACHINE_CODE);
  const hydratedKey = useRef<string | null>(null);

  const [crewNotes, setCrewNotes] = useState('');
  const [crewRoster, setCrewRoster] = useState<MachineCrewMember[]>([]);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());
  const [outgoingNotes, setOutgoingNotes] = useState('');
  const [notesError, setNotesError] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [machineStatus, setMachineStatus] = useState('IDLE');
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [metrics, setMetrics] = useState<{
    totalProdMt: number; coilsDone: number; avgLineSpeed: number; repeats: number;
    wpW?: number; wpP?: number; chartReadings: number; chartDue: number;
  } | null>(null);
  const [stoppages, setStoppages] = useState<Array<{ category_code?: string; start_at?: string; duration_min?: number; remarks?: string }>>([]);

  const loading = (previewLoading || draftLoading) && !preview && !previewError && !draftErrorSwr;
  const loadError = previewError || draftErrorSwr
    ? (previewError instanceof Error ? previewError.message : null)
      ?? (draftErrorSwr instanceof Error ? draftErrorSwr.message : null)
      ?? 'Failed to load'
    : null;

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!shiftLogId) return;
    void apiClient.get<typeof metrics>(`/stations/pkl/shift-metrics/${encodeURIComponent(shiftLogId)}`)
      .then(setMetrics)
      .catch(() => setMetrics(null));
    void apiClient.get<{ stoppages?: typeof stoppages }>(`/stations/pkl/shift-review?shiftLogId=${encodeURIComponent(shiftLogId)}`)
      .then((r) => setStoppages((r as { stoppages?: typeof stoppages }).stoppages ?? []))
      .catch(() => setStoppages([]));
  }, [shiftLogId]);

  useEffect(() => {
    if (!preview && !draft) return;
    const key = `${MACHINE_CODE}:${draft?.handover_id ?? 'nodraft'}`;
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;
    if (preview?.machineStatus) setMachineStatus(preview.machineStatus);
    if (draft) {
      const ps = draft.production_snapshot as Record<string, unknown>;
      if (ps?.crewNotes) setCrewNotes(String(ps.crewNotes));
      setOutgoingNotes(draft.remarks ?? '');
      if (draft.handover_priority) setPriority(draft.handover_priority as Priority);
    }
  }, [preview, draft]);

  useEffect(() => {
    void machineCrewService.list(MACHINE_CODE).then(setCrewRoster).catch(() => setCrewRoster([]));
  }, []);

  const nextCoils = useMemo(
    () => queue.filter((c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS').slice(0, 5),
    [queue],
  );

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
  }), [machineStatus, outgoingNotes, priority, crewNotes, selectedRosterIds]);

  const saveDraft = useCallback(async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await machineHandoverService.saveDraft(MACHINE_CODE, buildPayload());
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    } catch { /* soft */ } finally {
      setSaving(false);
    }
  }, [preview, buildPayload]);

  useEffect(() => {
    if (!preview) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(saveDraft, AUTO_SAVE_MS);
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
        <p className="text-sm text-muted-foreground">Loading PKL handover…</p>
      </div>
    );
  }

  const p = preview ?? {
    machineCode: MACHINE_CODE,
    shift: { shiftCode: '—', shiftName: '—', prodDate: '—', windowStart: undefined as string | undefined, windowEnd: undefined as string | undefined, actualSessionStartAt: undefined as string | undefined },
    nextShift: { shiftCode: '—', prodDate: '—' },
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {loadError && (
        <div className="shrink-0 px-5 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {loadError}
        </div>
      )}
      <div className="shrink-0 px-5 py-4 border-b border-border bg-card flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Outgoing Handover</p>
          <h1 className="text-lg font-bold">Pickling · Shift {p.shift.shiftCode}</h1>
          <p className="text-xs text-muted-foreground font-mono">
            {p.shift.prodDate} · {p.shift.windowStart ? formatPlantDateTime(p.shift.windowStart) : '—'}
            {' → '}
            {p.shift.windowEnd ? formatPlantDateTime(p.shift.windowEnd) : '—'}
          </p>
        </div>
        {draftSaved && <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Draft saved</span>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <SectionHeader icon={<Clock className="h-4 w-4" />} title="Production Summary" locked />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <LockedField label="Pickled MT" value={metrics ? metrics.totalProdMt.toFixed(2) : '—'} />
            <LockedField label="Coils" value={metrics?.coilsDone} />
            <LockedField label="Avg Speed M/min" value={metrics?.avgLineSpeed} />
            <LockedField label="W / P" value={metrics ? `${metrics.wpW ?? 0} / ${metrics.wpP ?? 0}` : '—'} />
            <LockedField label="Repeats" value={metrics?.repeats} />
            <LockedField label="Stoppages" value={stoppages.length} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <SectionHeader icon={<FlaskConical className="h-4 w-4" />} title="Process Chart Readings" locked />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <LockedField label="Logged" value={metrics?.chartReadings} />
            <LockedField label="Due" value={metrics?.chartDue} />
          </div>
          <ZButton type="button" variant="secondary" onClick={() => navigate(`${basePath}/chart`)}>Open Process Chart</ZButton>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <SectionHeader icon={<Lock className="h-4 w-4" />} title="Stoppages" locked />
          {stoppages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stoppages this shift</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stoppages.map((s, i) => (
                <li key={i} className="flex justify-between gap-2 border-b border-border/50 pb-2 font-mono text-xs">
                  <span>{s.category_code ?? '—'} · {s.remarks ?? ''}</span>
                  <span>{s.duration_min ?? '—'} min</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <SectionHeader icon={<Clock className="h-4 w-4" />} title="Next Orders" locked />
          {nextCoils.length === 0 ? (
            <p className="text-sm text-muted-foreground">Queue empty</p>
          ) : (
            <ul className="space-y-2">
              {nextCoils.map((c) => (
                <li key={c.coilNo} className="text-sm flex justify-between gap-2">
                  <span className="font-mono font-bold">{c.coilNo}</span>
                  <span className="text-muted-foreground">{c.gradeCode} · {c.weightMt} MT · {c.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <SectionHeader icon={<Users className="h-4 w-4" />} title="Crew Details" />
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
          <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Outgoing Notes" />
          <div className="flex gap-2 mb-3">
            {PRIORITIES.map((pr) => (
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
            placeholder={`Outgoing operator notes (min ${MIN_NOTES_LENGTH} chars) *`}
          />
          {notesError && <p className="text-destructive text-sm mt-1">{notesError}</p>}
        </section>

        {submitError && <p className="text-destructive text-sm">{submitError}</p>}
      </div>

      <div className="shrink-0 border-t border-border bg-card px-5 py-4 flex gap-3 justify-end">
        <ZButton type="button" variant="secondary" onClick={() => void saveDraft()} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</ZButton>
        <ZButton type="button" onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit & End Shift'}
        </ZButton>
      </div>
    </div>
  );
}
