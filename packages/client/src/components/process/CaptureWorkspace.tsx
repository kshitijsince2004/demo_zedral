import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { useProcessStore } from '../../store/processStore';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { getProcessConfig } from '../../lib/processConfig';
import { useShiftStore } from '../../store/shiftStore';
import { useAuthStore } from '../../lib/authStore';
import { resolveStoppageDisplayCode } from '../sixHi/SixHiStoppageCodes';
import { DefectTagSelector } from '../sixHi/DefectTagSelector';
import { OrderStoppageModal } from '../sixHi/OrderStoppageModal';
import { OrderRemarkModal } from '../sixHi/OrderRemarkModal';
import { DEFECT_OTHER_CODE } from '../../lib/defectCodes';
import type { CrewRole } from '@m1/shared-validation';
import { CrewRole as SharedCrewRole } from '@m1/shared-validation';
import { submitOrQueue } from '../../operator/sync/submitOrQueue';
import { QcCapturePanel } from './QcCapturePanel';
import { ProcessPPCCards } from './ProcessPPCCards';
import { ProcessStatusBanner } from './ProcessStatusBanner';

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
  const authUsername = useAuthStore((s) => s.username);
  const { shiftLogId } = useShiftStore();
  const {
    activePrefill,
    loadPrefill,
    setActiveCoil,
    requestQueueRefresh,
    captureStatus,
    defectPanelOpen,
    crewPanelOpen,
    remarkPanelOpen,
    closeDefectPanel,
    closeCrewPanel,
    closeRemarkPanel,
    stoppageCode,
    stoppageRemarks,
    stoppageStartedAt,
    setStoppageCode,
    setStoppageRemarks,
    startCapture,
    cancelStoppage,
    pklGroupCoilNos,
    pklGroupWeightMt,
    advancePklGroup,
    clearPklGroup,
    endCaptureToken,
    finishCapture,
  } = useProcessStore();
  const [prefill, setPrefill] = useState<Record<string, unknown>>(activePrefill ?? {});

  const [selectedDefects, setSelectedDefects] = useState<string[]>([]);
  const [otherDefectRemarks, setOtherDefectRemarks] = useState('');
  const [defectsBusy, setDefectsBusy] = useState(false);

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

  const [crewOperatorId, setCrewOperatorId] = useState('');
  const [crewRoleCode, setCrewRoleCode] = useState<CrewRole>(allowedCrewRoles[0] ?? SharedCrewRole.OPERATOR);
  const [crewEntries, setCrewEntries] = useState<Array<{ operatorId: string; roleCode: CrewRole }>>([]);
  const [crewBusy, setCrewBusy] = useState(false);

  useEffect(() => {
    setCrewOperatorId(authUsername ?? '');
  }, [authUsername]);

  useEffect(() => {
    if (defectPanelOpen) {
      setSelectedDefects([]);
      setOtherDefectRemarks('');
      setDefectsBusy(false);
    }
  }, [defectPanelOpen]);

  useEffect(() => {
    if (crewPanelOpen) {
      setCrewEntries([]);
      setCrewBusy(false);
      setCrewRoleCode(allowedCrewRoles[0] ?? SharedCrewRole.OPERATOR);
      setCrewOperatorId(authUsername ?? '');
    }
  }, [crewPanelOpen, allowedCrewRoles, authUsername]);

  useEffect(() => {
    setActiveCoil(coilNo);
    void loadPrefill(coilNo).then(setPrefill).catch(() => {
      /* soft: missing line access must not block Start/End rail */
    });
  }, [coilNo, loadPrefill, setActiveCoil]);

  // Rail End → submit production form (same path as Save / Complete).
  useEffect(() => {
    if (!endCaptureToken) return;
    const root = document.getElementById('process-capture-form');
    const form = root?.querySelector('form') ?? null;
    if (form) {
      form.requestSubmit();
      return;
    }
    root?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [endCaptureToken]);

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
  const surfaceRaw = fieldVal(prefill.surfaceFinish);
  const ppc = {
    motherCoilNo: fieldVal(prefill.motherCoilNo) ?? fieldVal(prefill.parentCoilNo),
    coilNo: fieldVal(prefill.displayCoilNo) ?? coilNo,
    customer: fieldVal(prefill.customerName) ?? fieldVal(prefill.customer),
    grade: gradeCode,
    slitId: fieldVal(prefill.slitId),
    widthMm: planWidth,
    thicknessMm: planThk,
    weightMt: fieldVal(prefill.weightMt) ?? (prefill.weightMt as number | undefined),
    route: processCode === 'RWD' ? undefined : fieldVal(prefill.routeRaw),
    batch: fieldVal(prefill.batchNumber),
    ...(processCode === 'RWD' ? {
      surface: surfaceRaw ?? '',
      planWidthMm: planWidth,
      planThicknessMm: planThk,
    } : {}),
  };

  const stoppageActive = captureStatus === 'stoppage';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-secondary">
      {/* Workspace chrome — rolling-grade green header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-primary text-white h-16">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-base font-bold shrink-0">Production Form</p>
          <span className="font-mono text-lg font-bold truncate">{coilNo}</span>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/15">
            {processCode}
          </span>
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

      <div id="process-capture-form" className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-2 flex flex-col gap-2">
          <ProcessStatusBanner
            compact
            stoppageLabel={stoppageRemarks.trim() || `Code ${stoppageCode}`}
          />
          {(processCode === 'PKL' || processCode === 'HRS') && stoppageActive && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5">Stoppage details</p>
              <p className="font-mono">Code {stoppageCode}{stoppageRemarks ? ` · ${stoppageRemarks}` : ''}</p>
            </div>
          )}
          <ProcessPPCCards
            compact
            data={ppc}
            groupCount={processCode === 'PKL' ? pklGroupCoilNos.length : undefined}
            groupWeightMt={processCode === 'PKL' && pklGroupCoilNos.length > 1 ? pklGroupWeightMt : undefined}
          />

          <div className="bg-card border border-border rounded-xl shadow overflow-hidden">
            <Body
              coilNo={coilNo}
              prefill={prefill}
              shiftLogId={shiftLogId ?? ''}
              machineCode={processCode}
              {...(processCode === 'RWD' ? { showSubmit: false, formId: 'rwd-capture-form' } : {})}
              onSubmitted={() => {
                requestQueueRefresh();
                closeDefectPanel();
                closeCrewPanel();
                closeRemarkPanel();
                if (processCode === 'PKL') {
                  const next = advancePklGroup(coilNo);
                  if (next) {
                    navigate(`${basePath}/capture/${encodeURIComponent(next)}`);
                    return;
                  }
                  clearPklGroup();
                }
                finishCapture();
                navigate(basePath);
              }}
            />
          </div>

          {/* ponytail: PKL pre-CR + RWD has no QC params — skip empty Quality checks panel */}
          {processCode !== 'PKL' && processCode !== 'RWD' && (
            <QcCapturePanel
              processCode={processCode}
              coilNo={coilNo}
              gradeCode={gradeCode}
              shiftLogId={shiftLogId ?? undefined}
            />
          )}
        </div>
      </div>

      {processCode === 'RWD' && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-3 z-10">
          <ZButton
            type="submit"
            form="rwd-capture-form"
            variant="primary"
            size="lg"
            fullWidth
            disabled={!shiftLogId}
            className="min-h-14 text-base font-bold"
          >
            Save Production Data
          </ZButton>
        </div>
      )}

      <OrderStoppageModal
        open={stoppageActive}
        hasActiveStoppage
        activeStoppage={{
          id: 'process-local',
          categoryCode: stoppageCode,
          categoryLabel: stoppageCode,
          startAt: stoppageStartedAt ?? new Date().toISOString(),
          remarks: stoppageRemarks,
        }}
        subtitle={`${processCode} · ${coilNo}`}
        title="Manage Stoppage"
        onClose={() => cancelStoppage()}
        onUpdate={async (_id, categoryCode, breakdownCode, remarks) => {
          setStoppageCode(resolveStoppageDisplayCode(categoryCode, breakdownCode));
          setStoppageRemarks(remarks ?? '');
        }}
        onEnd={async (_id, categoryCode, breakdownCode, remarks) => {
          setStoppageCode(resolveStoppageDisplayCode(categoryCode, breakdownCode));
          setStoppageRemarks(remarks ?? '');
          startCapture(coilNo);
        }}
      />

      {remarkPanelOpen && (
        <OrderRemarkModal
          open={remarkPanelOpen}
          batchNumber={coilNo}
          orderLabel={`${processCode} · ${coilNo}`}
          orderSubtitle={gradeCode}
          onClose={closeRemarkPanel}
          onSave={async (text, defects) => {
            if (!shiftLogId) throw new Error('No active shift');
            const codes = defects.length > 0
              ? defects.map((d) => d.defectCode)
              : [`${DEFECT_OTHER_CODE}:${text}`];
            await Promise.all(codes.map((defectCode) => submitOrQueue({
              url: '/defects',
              method: 'POST',
              payload: {
                shiftLogId,
                coilNo,
                defectCode,
                entryId: shiftLogId,
                remarks: text,
              },
              aggregateKey: `remark:${shiftLogId}:${coilNo}:${defectCode}`,
            })));
            closeRemarkPanel();
          }}
        />
      )}

      {defectPanelOpen && (
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
              />
            </div>

            <div className="mt-5 flex gap-3">
              <ZButton variant="secondary" onClick={closeDefectPanel} className="flex-1">Cancel</ZButton>
              <ZButton
                variant="accent"
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

      {crewPanelOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
          <button type="button" aria-label="Close crew panel" className="fixed inset-0 bg-primary/50" onClick={closeCrewPanel} />
          <div className="relative w-full max-w-xl border border-border bg-white rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Crew</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">Roster crew for this shift</h2>
              </div>
              <ZButton variant="ghost" onClick={closeCrewPanel}>Close</ZButton>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FieldWrapper label="Operator ID (emp code)">
                <ZInput
                  value={crewOperatorId}
                  onChange={(e) => setCrewOperatorId(e.target.value)}
                  placeholder="e.g. 12345"
                />
              </FieldWrapper>
              <FieldWrapper label="Role">
                <select
                  value={crewRoleCode}
                  onChange={(e) => setCrewRoleCode(e.target.value as CrewRole)}
                  className="w-full min-h-14 rounded-xl border border-input bg-background px-3 py-3 text-sm"
                >
                  {allowedCrewRoles.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </FieldWrapper>
            </div>

            <div className="flex gap-3">
              <ZButton
                variant="secondary"
                className="flex-1"
                disabled={!crewOperatorId.trim()}
                onClick={() => {
                  const opId = crewOperatorId.trim();
                  setCrewEntries((prev) => [...prev, { operatorId: opId, roleCode: crewRoleCode }]);
                  setCrewOperatorId(opId);
                }}
              >
                Add to roster
              </ZButton>
              <ZButton
                variant="accent"
                className="flex-1"
                disabled={!shiftLogId || crewEntries.length === 0 || crewBusy}
                onClick={async () => {
                  if (!shiftLogId) return;
                  setCrewBusy(true);
                  try {
                    await Promise.all(crewEntries.map((e) => submitOrQueue({
                      url: '/crew',
                      method: 'POST',
                      payload: {
                        shiftLogId,
                        operatorId: e.operatorId,
                        roleCode: e.roleCode,
                      },
                      aggregateKey: `crew:${shiftLogId}:${e.operatorId}:${e.roleCode}`,
                    })));
                    closeCrewPanel();
                  } finally {
                    setCrewBusy(false);
                  }
                }}
              >
                {crewBusy ? 'Saving…' : 'Submit Crew'}
              </ZButton>
            </div>

            {crewEntries.length > 0 && (
              <div className="rounded-xl border border-border bg-secondary/30 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Pending crew entries ({crewEntries.length})
                </p>
                <div className="space-y-2">
                  {crewEntries.map((e, i) => (
                    <div key={`${e.operatorId}:${e.roleCode}:${i}`} className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm">{e.operatorId}</span>
                      <span className="text-sm text-muted-foreground">{e.roleCode}</span>
                      <ZButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setCrewEntries((prev) => prev.filter((_x, idx) => idx !== i))}
                      >
                        Remove
                      </ZButton>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
