import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { useProcessStore } from '../../store/processStore';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { getProcessConfig } from '../../lib/processConfig';
import { useShiftStore } from '../../store/shiftStore';
import { useAuthStore } from '../../lib/authStore';
import { useSixHiStoppageCodes } from '../sixHi/SixHiStoppageCodes';
import { StoppageCodeSelect } from '../sixHi/StoppageCodeSelect';
import { DefectTagSelector } from '../sixHi/DefectTagSelector';
import { DEFECT_OTHER_CODE } from '../../lib/defectCodes';
import type { CrewRole } from '@m1/shared-validation';
import { CrewRole as SharedCrewRole } from '@m1/shared-validation';
import { submitOrQueue } from '../../operator/sync/submitOrQueue';
import { QcCapturePanel } from './QcCapturePanel';

interface CaptureWorkspaceProps {
  processCode: string;
  coilNo: string;
}

export function CaptureWorkspace({ processCode, coilNo }: CaptureWorkspaceProps) {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const config = getProcessConfig(processCode);
  const authUsername = useAuthStore((s) => s.username);
  const { shiftLogId } = useShiftStore();
  const { codes: stoppageCodes, loading: stoppageLoading } = useSixHiStoppageCodes();
  const {
    activePrefill,
    loadPrefill,
    setActiveCoil,
    requestQueueRefresh,
    captureStatus,
    defectPanelOpen,
    crewPanelOpen,
    closeDefectPanel,
    closeCrewPanel,
    stoppageCode,
    stoppageRemarks,
    setStoppageCode,
    setStoppageRemarks,
    pklGroupCoilNos,
    pklGroupWeightMt,
    advancePklGroup,
    clearPklGroup,
  } = useProcessStore();
  const [prefill, setPrefill] = useState<Record<string, unknown>>(activePrefill ?? {});

  const [selectedDefects, setSelectedDefects] = useState<string[]>([]);
  const [otherDefectRemarks, setOtherDefectRemarks] = useState('');
  const [defectsBusy, setDefectsBusy] = useState(false);

  const allowedCrewRoles = useMemo(() => {
    const code = processCode.toUpperCase();
    // These role codes are what the server CrewService accepts.
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
    // Prime operatorId default from the logged-in username (server resolves by emp_code/name).
    setCrewOperatorId(authUsername ?? '');
  }, [authUsername]);

  useEffect(() => {
    // Reset defect/crew form state when panels open.
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
    void loadPrefill(coilNo).then(setPrefill);
  }, [coilNo, loadPrefill, setActiveCoil]);

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

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg">{config.label} Capture</h1>
          <p className="text-sm text-muted-foreground">{coilNo}</p>
          {processCode === 'PKL' && pklGroupCoilNos.length > 1 && (
            <p className="text-xs mt-1 font-medium tabular-nums">
              Group {pklGroupCoilNos.length} coils · Σ {pklGroupWeightMt.toFixed(2)} MT
              {' · '}
              {pklGroupCoilNos.indexOf(coilNo) + 1}/{pklGroupCoilNos.length}
            </p>
          )}
        </div>
        <ZButton type="button" variant="secondary" onClick={() => navigate(basePath)}>Back to Hub</ZButton>
      </div>

      <Body
        coilNo={coilNo}
        prefill={prefill}
        shiftLogId={shiftLogId ?? ''}
        machineCode={processCode}
        onSubmitted={() => {
          requestQueueRefresh();
          closeDefectPanel();
          closeCrewPanel();
          if (processCode === 'PKL') {
            const next = advancePklGroup(coilNo);
            if (next) {
              navigate(`${basePath}/capture/${encodeURIComponent(next)}`);
              return;
            }
            clearPklGroup();
          }
          navigate(basePath);
        }}
      />

      <QcCapturePanel
        processCode={processCode}
        coilNo={coilNo}
        gradeCode={gradeCode}
        shiftLogId={shiftLogId ?? undefined}
      />

      {/* Stoppage panel: Stop => captureStatus='stoppage', Start => resumes and persists stoppage row */}
      {captureStatus === 'stoppage' && (
        <div className="mt-4 mx-4 mb-6 rounded-xl border border-border bg-card p-4 space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Stoppage
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Select stoppage code</h2>
          </div>

          <FieldWrapper label="Stoppage Code" required>
            <StoppageCodeSelect
              value={stoppageCode}
              onChange={setStoppageCode}
              codes={stoppageCodes}
              loading={stoppageLoading}
              disabled={!shiftLogId}
            />
          </FieldWrapper>

          <FieldWrapper label="Remarks">
            <ZInput
              value={stoppageRemarks}
              onChange={(e) => setStoppageRemarks(e.target.value)}
              placeholder="Optional stoppage remarks"
            />
          </FieldWrapper>

          <p className="text-xs text-muted-foreground">
            Press <span className="font-semibold">Start</span> on the action rail to end stoppage and resume capture.
          </p>
        </div>
      )}

      {/* Defect panel */}
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

      {/* Crew panel */}
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
