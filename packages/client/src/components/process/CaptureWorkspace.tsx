import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';
import { useProcessStore } from '../../store/processStore';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { getProcessConfig } from '../../lib/processConfig';
import { useShiftStore } from '../../store/shiftStore';
import { DefectTagSelector } from '../sixHi/DefectTagSelector';
import { OrderStoppageModal } from '../sixHi/OrderStoppageModal';
import { CrewCaptureModal } from '../sixHi/CrewCaptureModal';
import { DEFECT_OTHER_CODE } from '../../lib/defectCodes';
import { toStoppageCategoryCode, useMachineStoppageCodes } from '../../lib/pklStoppageCodes';
import type { CrewRole } from '@m1/shared-validation';
import { CrewRole as SharedCrewRole } from '@m1/shared-validation';
import { submitOrQueue } from '../../operator/sync/submitOrQueue';
import { QcCapturePanel } from './QcCapturePanel';
import { ProcessPPCCards } from './ProcessPPCCards';
import { ProcessStatusBanner } from './ProcessStatusBanner';
import type { MachineCrewMember } from '../../lib/machineCrewService';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';

interface CaptureWorkspaceProps {
  processCode: string;
  coilNo: string;
}

function fieldVal(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    const v = (raw as { value: unknown }).value;
    if (v == null || v === '') return undefined;
    return String(v);
  }
  return String(raw);
}

export function CaptureWorkspace({ processCode, coilNo }: CaptureWorkspaceProps) {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const config = getProcessConfig(processCode);
  const { shiftLogId } = useShiftStore();
  const captureStatus = useProcessStore((s) => s.captureStatus);
  const defectPanelOpen = useProcessStore((s) => s.defectPanelOpen);
  const crewPanelOpen = useProcessStore((s) => s.crewPanelOpen);
  const closeDefectPanel = useProcessStore((s) => s.closeDefectPanel);
  const closeCrewPanel = useProcessStore((s) => s.closeCrewPanel);
  const stoppageCode = useProcessStore((s) => s.stoppageCode);
  const stoppageRemarks = useProcessStore((s) => s.stoppageRemarks);
  const stoppageStartedAt = useProcessStore((s) => s.stoppageStartedAt);
  const pklGroupCoilNos = useProcessStore((s) => s.pklGroupCoilNos);
  const pklGroupWeightMt = useProcessStore((s) => s.pklGroupWeightMt);
  const endCaptureToken = useProcessStore((s) => s.endCaptureToken);
  const queue = useProcessStore((s) => s.queue);
  const stoppageManageToken = useProcessStore((s) => s.stoppageManageToken);
  const [prefill, setPrefill] = useState<Record<string, unknown>>(
    () => useProcessStore.getState().activePrefill ?? {},
  );
  const queueStatus = queue.find((c) => c.coilNo === coilNo)?.status;
  const isCompleted = queueStatus === 'COMPLETED';

  const [selectedDefects, setSelectedDefects] = useState<string[]>([]);
  const [otherDefectRemarks, setOtherDefectRemarks] = useState('');
  const [defectsBusy, setDefectsBusy] = useState(false);
  const [manageStoppageOpen, setManageStoppageOpen] = useState(false);
  const { codes: machineStoppageCodes, loading: machineStoppageCodesLoading } = useMachineStoppageCodes(processCode);
  const isPkl = processCode === 'PKL';
  const isHrs = processCode === 'HRS';
  const isHrsOrPkl = isHrs || isPkl;
  // Prefer machine-classified stoppage codes; PKL keeps legacy alias for clarity
  const stoppageCodes = machineStoppageCodes;
  const stoppageCodesLoading = machineStoppageCodesLoading;

  const allowedCrewRoles = useMemo(() => {
    const code = processCode.toUpperCase();
    const mapping: Record<string, CrewRole[]> = {
      ANN: [SharedCrewRole.OPERATOR, SharedCrewRole.ASST, SharedCrewRole.SHIFT_INCHARGE],
      PKL: [SharedCrewRole.HELPER],
      CTL: [SharedCrewRole.ASST, SharedCrewRole.OPERATOR],
      HRS: [SharedCrewRole.OPERATOR, SharedCrewRole.ASST, SharedCrewRole.HELPER],
      CRS: [SharedCrewRole.OPERATOR, SharedCrewRole.ASST, SharedCrewRole.HELPER],
      RWD: [SharedCrewRole.OPERATOR, SharedCrewRole.ASST, SharedCrewRole.HELPER],
    };
    return mapping[code] ?? [SharedCrewRole.OPERATOR, SharedCrewRole.ASST, SharedCrewRole.HELPER];
  }, [processCode]);

  function mapRole(label: string): CrewRole {
    const u = label.toUpperCase();
    if (u.includes('INCHARGE') || u.includes('IN-CHARGE')) return SharedCrewRole.SHIFT_INCHARGE;
    if (u.includes('HELPER')) return SharedCrewRole.HELPER;
    if (u.includes('ASST')) return SharedCrewRole.ASST;
    if (allowedCrewRoles.includes(u as CrewRole)) return u as CrewRole;
    return allowedCrewRoles[0] ?? SharedCrewRole.OPERATOR;
  }

  useEffect(() => {
    if (isCompleted) {
      closeDefectPanel();
      closeCrewPanel();
      useProcessStore.getState().closeRemarkPanel();
    }
  }, [isCompleted, closeDefectPanel, closeCrewPanel]);

  useEffect(() => {
    if (defectPanelOpen) {
      setSelectedDefects([]);
      setOtherDefectRemarks('');
      setDefectsBusy(false);
    }
  }, [defectPanelOpen]);

  useEffect(() => {
    // Keep hub-seeded orderLines until entry prefill returns (do not wipe to null).
    const seeded = useProcessStore.getState().activePrefill;
    useProcessStore.getState().setActiveCoil(coilNo, seeded);
    void useProcessStore.getState().loadPrefill(coilNo).then((p) => {
      const orderLines = (p as { orderLines?: unknown[] }).orderLines;
      const seededLines = (seeded as { orderLines?: unknown[] } | null)?.orderLines;
      if ((!orderLines || orderLines.length === 0) && seededLines?.length) {
        const merged = { ...p, orderLines: seededLines };
        setPrefill(merged);
        useProcessStore.setState({ activePrefill: merged });
        return;
      }
      setPrefill(p);
    }).catch(() => {
      /* soft: missing line access must not block Start/End rail */
    });
  }, [coilNo]);

  // Rail End → OrderEndModal → form.requestSubmit (finalize only; Save uses draft endpoint).
  useEffect(() => {
    if (!endCaptureToken || isCompleted) return;
    const root = document.getElementById('process-capture-form');
    const form = root?.querySelector('form') ?? null;
    if (!form) {
      useProcessStore.getState().settleEndCaptureError(
        'Capture form not ready — open Capture and try End again.',
      );
      root?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const onInvalid = () => {
      useProcessStore.getState().settleEndCaptureError(
        'Fix required capture fields before ending production.',
      );
    };
    form.addEventListener('invalid', onInvalid, true);
    form.requestSubmit();
    return () => form.removeEventListener('invalid', onInvalid, true);
  }, [endCaptureToken, isCompleted]);

  const Body = config.bodyComponent;

  const gradeCode = (() => {
    const f = prefill.gradeCode ?? prefill.grade_code;
    if (f == null) return undefined;
    if (typeof f === 'object' && f !== null && 'value' in f) {
      const v = (f as { value: unknown }).value;
      return v != null && v !== '' ? String(v) : undefined;
    }
    return String(f);
  })();

  const planWidth = fieldVal(prefill.widthMm) ?? (prefill.widthMm as number | undefined);
  const planThk = fieldVal(prefill.thicknessMm) ?? (prefill.thicknessMm as number | undefined)
    ?? fieldVal(prefill.outputThkMmFallback);
  const ppc = {
    motherCoilNo: fieldVal(prefill.motherCoilNo) ?? fieldVal(prefill.parentCoilNo),
    coilNo: fieldVal(prefill.displayCoilNo) ?? coilNo,
    customer: fieldVal(prefill.customerName) ?? fieldVal(prefill.customer),
    grade: gradeCode,
    slitId: (() => {
      const direct = fieldVal(prefill.slitId);
      if (direct) return direct;
      const planned = (Array.isArray(prefill.orderLines) ? prefill.orderLines : [])
        .map((line) => fieldVal((line as Record<string, unknown>).slitId))
        .filter((value): value is string => !!value);
      if (planned.length === 0) return undefined;
      return [...new Set(planned)].join(', ');
    })(),
    widthMm: planWidth,
    thicknessMm: planThk,
    weightMt: fieldVal(prefill.weightMt) ?? (prefill.weightMt as number | undefined),
    route: fieldVal(prefill.routeRaw),
    batch: fieldVal(prefill.batchNumber),
  };

  const coilIdentity = displayMotherCoilId({
    motherCoilNo: ppc.motherCoilNo,
    displayCoilNo: fieldVal(prefill.displayCoilNo),
    coilNo,
    batchNumber: ppc.batch ?? coilNo,
    slitId: ppc.slitId,
  });

  const stoppageActive = captureStatus === 'stoppage';

  useEffect(() => {
    if (stoppageActive) setManageStoppageOpen(true);
  }, [stoppageActive]);

  useEffect(() => {
    if (stoppageManageToken > 0 && stoppageActive) setManageStoppageOpen(true);
  }, [stoppageManageToken, stoppageActive]);

  const bannerAndPpc = (
    <>
      <ProcessStatusBanner
        compact
        timerMode={isHrsOrPkl ? 'net' : 'wall'}
        stoppageLabel={stoppageRemarks.trim() || `Code ${stoppageCode}`}
        /** HRS/PKL: live stoppage clock lives on the action rail only — avoid duplicate timers. */
        hideStoppageTimer={isHrsOrPkl}
      />
      {!isHrsOrPkl && stoppageActive && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5">Stoppage details</p>
          <p className="font-mono">Code {stoppageCode}{stoppageRemarks ? ` · ${stoppageRemarks}` : ''}</p>
        </div>
      )}
      <ProcessPPCCards
        compact
        data={ppc}
        hideRoute={isHrs}
        groupCount={processCode === 'PKL' ? pklGroupCoilNos.length : undefined}
        groupWeightMt={processCode === 'PKL' && pklGroupCoilNos.length > 1 ? pklGroupWeightMt : undefined}
      />
    </>
  );

  const captureBody = (
    <div
      className={[
        'bg-card border border-border rounded-xl shadow overflow-hidden',
        isHrs ? 'flex-1 min-h-0 flex flex-col' : '',
        isCompleted ? 'opacity-70' : '',
      ].join(' ')}
      aria-readonly={isCompleted || undefined}
    >
      <Body
        coilNo={coilNo}
        prefill={prefill}
        shiftLogId={shiftLogId ?? ''}
        machineCode={processCode}
        onSubmitted={() => {
          if (isCompleted) return;
          const store = useProcessStore.getState();
          store.settleEndCaptureOk();
          store.requestQueueRefresh();
          closeDefectPanel();
          closeCrewPanel();
          store.closeRemarkPanel();
          if (processCode === 'PKL') {
            const next = store.advancePklGroup(coilNo);
            if (next) {
              navigate(`${basePath}/capture/${encodeURIComponent(next)}`);
              return;
            }
            store.clearPklGroup();
          }
          store.finishCapture();
          navigate(isHrsOrPkl ? `${basePath}?status=COMPLETED` : basePath);
        }}
      />
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-secondary">
      {/* Workspace chrome — rolling-grade green header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-primary text-white h-16">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-base font-bold shrink-0">Production Console</p>
          <span className="font-mono text-lg font-bold truncate">{coilIdentity}</span>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/15">
            {processCode}
          </span>
          {isCompleted && (
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-success/30 text-white">
              COMPLETED · Read-only
            </span>
          )}
          {processCode === 'PKL' && pklGroupCoilNos.length > 1 && (
            <span className="text-xs opacity-90 tabular-nums hidden sm:inline">
              Selected {pklGroupCoilNos.length} · Σ {pklGroupWeightMt.toFixed(2)} MT
              {' · '}
              {pklGroupCoilNos.indexOf(coilNo) + 1}/{pklGroupCoilNos.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigate(basePath)}
          className="min-h-10 min-w-10 flex items-center justify-center rounded-lg hover:bg-white/10 shrink-0"
          aria-label="Back to hub"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div id="process-capture-form" className={isHrs ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'}>
        {isHrs ? (
          <>
            <div className="shrink-0 p-2 flex flex-col gap-2">{bannerAndPpc}</div>
            <div className="flex-1 min-h-0 px-2 pb-2 flex flex-col">{captureBody}</div>
          </>
        ) : (
          <div className="p-2 flex flex-col gap-2">
            {bannerAndPpc}
            {captureBody}
            {processCode !== 'PKL' && (
              <QcCapturePanel
                processCode={processCode}
                coilNo={coilNo}
                gradeCode={gradeCode}
                shiftLogId={shiftLogId ?? undefined}
              />
            )}
          </div>
        )}
      </div>

      <OrderStoppageModal
        open={stoppageActive && manageStoppageOpen}
        hasActiveStoppage
        activeStoppage={{
          id: 'process-local',
          categoryCode: stoppageCode,
          categoryLabel: stoppageCode,
          startAt: stoppageStartedAt ?? new Date().toISOString(),
          remarks: stoppageRemarks,
        }}
        subtitle={`${processCode} · ${coilIdentity}`}
        title="Manage Stoppage"
        stoppageCodes={stoppageCodes}
        stoppageCodesLoading={stoppageCodesLoading}
        onClose={() => setManageStoppageOpen(false)}
        onUpdate={async (_id, categoryCode, _breakdownCode, remarks) => {
          const store = useProcessStore.getState();
          store.setStoppageCode(toStoppageCategoryCode(categoryCode));
          store.setStoppageRemarks(remarks ?? '');
        }}
        onEnd={async (_id, categoryCode, _breakdownCode, remarks) => {
          const store = useProcessStore.getState();
          store.setStoppageCode(toStoppageCategoryCode(categoryCode));
          store.setStoppageRemarks(remarks ?? '');
          setManageStoppageOpen(false);
          store.startCapture(coilNo);
        }}
      />

      {defectPanelOpen && !isCompleted && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
          <button type="button" aria-label="Close defect panel" className="fixed inset-0 bg-primary/50" onClick={closeDefectPanel} />
          <div className="relative w-full max-w-xl border border-border bg-white rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Defect</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">Tag defects for this entry</h2>
              </div>
              <ZButton variant="ghost" onClick={closeDefectPanel}>Close</ZButton>
            </div>

            <div className="mt-4">
              <DefectTagSelector
                selected={selectedDefects}
                onToggle={(code) => {
                  setSelectedDefects((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
                }}
                otherRemarks={otherDefectRemarks}
                onOtherRemarksChange={setOtherDefectRemarks}
                variant="end"
                enabled={!!shiftLogId}
                appliesTo={processCode}
              />
            </div>

            <div className="mt-5 flex gap-3">
              <ZButton variant="secondary" onClick={closeDefectPanel} className="flex-1">Cancel</ZButton>
              <ZButton
                variant="primary"
                disabled={!shiftLogId || defectsBusy || selectedDefects.length === 0}
                className="flex-1"
                onClick={async () => {
                  if (!shiftLogId) return;
                  setDefectsBusy(true);
                  try {
                    const payloadCodes = selectedDefects.map((c) => {
                      if (c !== DEFECT_OTHER_CODE) return c;
                      const trimmed = otherDefectRemarks.trim();
                      return trimmed ? `${DEFECT_OTHER_CODE}:${trimmed}` : DEFECT_OTHER_CODE;
                    });
                    await Promise.all(payloadCodes.map((defectCode) => submitOrQueue({
                      url: '/defects',
                      method: 'POST',
                      payload: {
                        shiftLogId,
                        coilNo,
                        defectCode,
                        entryId: shiftLogId,
                      },
                      aggregateKey: `defect:${shiftLogId}:${coilNo}:${defectCode}`,
                    })));
                    closeDefectPanel();
                  } finally {
                    setDefectsBusy(false);
                  }
                }}
              >
                {defectsBusy ? 'Saving…' : 'Save Defects'}
              </ZButton>
            </div>
          </div>
        </div>
      )}

      <CrewCaptureModal
        open={crewPanelOpen && !isCompleted}
        machineCode={processCode}
        onDone={closeCrewPanel}
        onSnooze={closeCrewPanel}
        title="Roster crew for this shift"
        subtitle={`${processCode} · ${coilIdentity}`}
        onConfirm={async (members: MachineCrewMember[]) => {
          if (!shiftLogId) throw new Error('No active shift');
          await Promise.all(members.map((m) => submitOrQueue({
            url: '/crew',
            method: 'POST',
            payload: {
              shiftLogId,
              operatorId: m.memberName,
              roleCode: mapRole(m.roleLabel),
            },
            aggregateKey: `crew:${shiftLogId}:${m.id}`,
          })));
        }}
      />
    </div>
  );
}
