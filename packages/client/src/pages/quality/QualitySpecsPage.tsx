import { useCallback, useEffect, useState } from 'react';

import { Link, useLocation, useNavigate } from 'react-router-dom';

import { QualityShell } from '../../components/layout/quality/QualityShell';

import { ZButton } from '../../components/primitives/ZButton';

import { ZInput } from '../../components/primitives/ZInput';

import { apiClient } from '../../lib/apiClient';

type Tab = 'specs' | 'catalog' | 'create' | 'repin' | 'qc' | 'process';

function tabFromSearch(search: string): Tab {
  const t = new URLSearchParams(search).get('tab');
  if (t === 'catalog' || t === 'create' || t === 'repin' || t === 'qc' || t === 'process') return t;
  return 'specs';
}

interface SpecRow {
  spec_sheet_id: number;
  grade_code: string;
  material_code: string;
  customer_id?: number | null;
  customer_name?: string | null;
  title?: string | null;
  active_version_no?: number | null;
  active_status?: string | null;
  is_active: boolean;
}

interface ParamRow {
  parameter_code: string;
  label: string;
  unit?: string | null;
  limit_kind: string;
  param_group?: string | null;
  data_type?: string;
  applies_to?: string[];
  sort_order?: number;
  is_mandatory_default?: boolean;
}

interface QcRow {
  qc_id: number;
  coil_no: string;
  process_code: string;
  parameter_code: string;
  label?: string;
  measured_value_num?: number | null;
  verdict: string;
  measured_at: string;
}

interface ProcessSheetRow {
  process_sheet_id: number;
  grade_code: string;
  customer_name?: string | null;
  route_code?: string | null;
  title?: string | null;
  status: string;
}

export function QualitySpecsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [specs, setSpecs] = useState<SpecRow[]>([]);
  const [params, setParams] = useState<ParamRow[]>([]);
  const [qcRows, setQcRows] = useState<QcRow[]>([]);
  const [processSheets, setProcessSheets] = useState<ProcessSheetRow[]>([]);
  const [grade, setGrade] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => tabFromSearch(window.location.search));
  useEffect(() => {
    setTab(tabFromSearch(location.search));
  }, [location.search]);
  const [busy, setBusy] = useState(false);
  const [newGrade, setNewGrade] = useState('');
  const [newMaterial, setNewMaterial] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newWidth, setNewWidth] = useState('');
  const [newThk, setNewThk] = useState('');
  const [newLength, setNewLength] = useState('');
  const [newSurface, setNewSurface] = useState('');
  const [paramCode, setParamCode] = useState('');
  const [paramLabel, setParamLabel] = useState('');
  const [paramUnit, setParamUnit] = useState('');
  const [paramGroup, setParamGroup] = useState('MECH');
  const [paramKind, setParamKind] = useState('MIN_MAX');
  const [paramApplies, setParamApplies] = useState('ALL');
  const [repinOrderId, setRepinOrderId] = useState('');
  const [repinVersionId, setRepinVersionId] = useState('');
  const [repinReason, setRepinReason] = useState('');
  const [repinMsg, setRepinMsg] = useState<string | null>(null);
  const [psGrade, setPsGrade] = useState('');
  const [psTitle, setPsTitle] = useState('');
  const [psSteps, setPsSteps] = useState('HRS:HARDNESS,UTS;PKL:RA_UM;CRS:HARDNESS,UTS,ELONGATION,RA_UM,RZ');
  const loadSpecs = useCallback(async () => {
    setError(null);
    try {
      const q = grade ? `?grade=${encodeURIComponent(grade)}` : '';
      setSpecs(await apiClient.get<SpecRow[]>(`/quality/specs${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load specs');
    }
  }, [grade]);
  const loadParams = useCallback(async () => {
    setError(null);
    try {
      setParams(await apiClient.get<ParamRow[]>('/quality/parameters'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog');
    }
  }, []);
  const loadQc = useCallback(async () => {
    setError(null);
    try {
      setQcRows(await apiClient.get<QcRow[]>('/quality/qc-measurements?verdict=FAIL&limit=100'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load QC fails');
    }
  }, []);
  const loadProcessSheets = useCallback(async () => {
    setError(null);
    try {
      setProcessSheets(await apiClient.get<ProcessSheetRow[]>('/quality/process-sheets'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load process sheets');
    }
  }, []);
  useEffect(() => {
    if (tab === 'catalog') void loadParams();
    else if (tab === 'specs') void loadSpecs();
    else if (tab === 'qc') void loadQc();
    else if (tab === 'process') void loadProcessSheets();
  }, [tab, loadSpecs, loadParams, loadQc, loadProcessSheets]);
  async function createSpec() {
    if (!newGrade.trim()) {
      setError('Grade is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await apiClient.post<{ sheet: { spec_sheet_id: number } }>('/quality/specs', {
        gradeCode: newGrade.trim(),
        materialCode: newMaterial.trim(),
        title: newTitle.trim() || undefined,
        customerId: newCustomerId === '' ? null : Number(newCustomerId),
        widthMm: newWidth === '' ? null : Number(newWidth),
        finishThkMm: newThk === '' ? null : Number(newThk),
        lengthMm: newLength === '' ? null : Number(newLength),
        surfaceFinish: newSurface.trim() || null,
      });
      navigate(`/quality/specs/${created.sheet.spec_sheet_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }
  async function saveParameter() {
    if (!paramCode.trim() || !paramLabel.trim()) {
      setError('Code and label required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/quality/parameters', {
        parameterCode: paramCode.trim().toUpperCase(),
        label: paramLabel.trim(),
        unit: paramUnit.trim() || null,
        group: paramGroup.trim() || null,
        limitKind: paramKind,
        dataType: paramKind === 'EXACT' && !paramUnit ? 'TEXT' : 'NUMERIC',
        appliesTo: paramApplies.split(',').map((s) => s.trim()).filter(Boolean),
        sortOrder: (params.length + 1) * 10,
      });
      setParamCode('');
      setParamLabel('');
      setParamUnit('');
      await loadParams();
      setTab('catalog');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save parameter failed');
    } finally {
      setBusy(false);
    }
  }
  async function retireParameter(code: string) {
    const blast = await apiClient.get<{ versionCount: number; qcCount: number }>(
      `/quality/parameters/${encodeURIComponent(code)}/blast-radius`,
    );
    if (
      !window.confirm(
        `Retire ${code}? Affects ~${blast.versionCount} version rows and ${blast.qcCount} QC rows. Soft-delete only.`,
      )
    ) {
      return;
    }
    const typed = window.prompt(`Type ${code} to confirm retirement`);
    if (typed !== code) {
      setError('Confirmation did not match');
      return;
    }
    setBusy(true);
    try {
      await apiClient.post(`/quality/parameters/${encodeURIComponent(code)}/retire`, { confirm: code });
      await loadParams();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retire failed');
    } finally {
      setBusy(false);
    }
  }
  async function repinOrder() {
    if (!repinOrderId.trim() || !repinVersionId.trim() || !repinReason.trim()) {
      setError('Plan order ID, version ID, and reason are required');
      return;
    }
    if (!window.confirm('Re-pin this order to a specific spec version? This overrides auto-resolve.')) return;
    setBusy(true);
    setError(null);
    setRepinMsg(null);
    try {
      await apiClient.put(`/quality/orders/${encodeURIComponent(repinOrderId.trim())}/spec`, {
        versionId: Number(repinVersionId),
        overrideReason: repinReason.trim(),
      });
      setRepinMsg(`Order ${repinOrderId} pinned to version ${repinVersionId}`);
      setRepinReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-pin failed');
    } finally {
      setBusy(false);
    }
  }
  async function createProcessSheet() {
    if (!psGrade.trim()) {
      setError('Grade required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const steps = psSteps.split(';').map((chunk, i) => {
        const [proc, codes] = chunk.split(':');
        return {
          processCode: (proc || '').trim().toUpperCase(),
          seqNo: i + 1,
          parameterCodes: (codes || '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
        };
      }).filter((s) => s.processCode);
      const created = await apiClient.post<{ sheet: { process_sheet_id: number } }>('/quality/process-sheets', {
        gradeCode: psGrade.trim(),
        title: psTitle.trim() || undefined,
        steps,
      });
      await apiClient.post(`/quality/process-sheets/${created.sheet.process_sheet_id}/publish`, {});
      setPsGrade('');
      setPsTitle('');
      await loadProcessSheets();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Process sheet create failed');
    } finally {
      setBusy(false);
    }
  }
  function exportQcCsv() {
    const header = ['When', 'Coil', 'Process', 'Parameter', 'Value', 'Verdict'];
    const lines = [header.join(',')].concat(
      qcRows.map((r) =>
        [
          new Date(r.measured_at).toISOString(),
          r.coil_no,
          r.process_code,
          r.label || r.parameter_code,
          r.measured_value_num ?? '',
          r.verdict,
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(','),
      ),
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qc_fails_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'specs', label: 'Spec sheets' },
    { id: 'create', label: 'New spec' },
    { id: 'catalog', label: 'Parameter catalog' },
    { id: 'process', label: 'Process sheets' },
    { id: 'qc', label: 'QC fails' },
    { id: 'repin', label: 'Re-pin order' },
  ];
  return (
    <QualityShell title="Quality Spec Sheets">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <ZButton
              key={t.id}
              type="button"
              variant={tab === t.id ? 'primary' : 'secondary'}
              onClick={() => {
                setTab(t.id);
                navigate(t.id === 'specs' ? '/quality/specs' : `/quality/specs?tab=${t.id}`);
              }}
            >
              {t.label}
            </ZButton>
          ))}
        </div>
        {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}
        {tab === 'specs' && (
          <>
            <div className="flex gap-2 items-end">
              <ZInput label="Filter grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
              <ZButton type="button" onClick={() => void loadSpecs()}>Refresh</ZButton>
            </div>
            <div className="overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left">
                  <tr>
                    <th className="p-2">Grade</th>
                    <th className="p-2">Material</th>
                    <th className="p-2">Customer</th>
                    <th className="p-2">Title</th>
                    <th className="p-2">Active</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {specs.map((s) => (
                    <tr key={s.spec_sheet_id} className="border-t">
                      <td className="p-2 font-medium">{s.grade_code}</td>
                      <td className="p-2">{s.material_code || '—'}</td>
                      <td className="p-2">
                        {s.customer_id == null ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-muted">default</span>
                        ) : (
                          s.customer_name || s.customer_id
                        )}
                      </td>
                      <td className="p-2">{s.title || '—'}</td>
                      <td className="p-2">{s.active_version_no != null ? `v${s.active_version_no}` : '—'}</td>
                      <td className="p-2 text-right">
                        <Link className="underline text-sm" to={`/quality/specs/${s.spec_sheet_id}`}>Edit</Link>
                      </td>
                    </tr>
                  ))}
                  {!specs.length && (
                    <tr><td className="p-4 text-muted-foreground" colSpan={6}>No spec sheets yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === 'create' && (
          <div className="border rounded-lg p-4 space-y-3 max-w-2xl">
            <p className="text-sm text-muted-foreground">
              A new row is created only when identity keys differ (grade, material, surface, width, thickness, length, customer).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <ZInput label="Grade *" value={newGrade} onChange={(e) => setNewGrade(e.target.value)} />
              <ZInput label="Material code" value={newMaterial} onChange={(e) => setNewMaterial(e.target.value)} />
              <ZInput label="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              <ZInput label="Customer ID (blank = default)" value={newCustomerId} onChange={(e) => setNewCustomerId(e.target.value)} />
              <ZInput label="Surface finish" value={newSurface} onChange={(e) => setNewSurface(e.target.value)} />
              <ZInput label="Width mm" type="number" value={newWidth} onChange={(e) => setNewWidth(e.target.value)} />
              <ZInput label="Finish thk mm" type="number" value={newThk} onChange={(e) => setNewThk(e.target.value)} />
              <ZInput label="Length mm" type="number" value={newLength} onChange={(e) => setNewLength(e.target.value)} />
            </div>
            <ZButton type="button" disabled={busy} onClick={() => void createSpec()}>Create DRAFT v1</ZButton>
          </div>
        )}
        {tab === 'repin' && (
          <div className="border rounded-lg p-4 space-y-3 max-w-2xl">
            <p className="text-sm text-muted-foreground">
              Manually pin a plan order to a specific spec version. Requires an override reason (audit).
            </p>
            {repinMsg && <p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2">{repinMsg}</p>}
            <div className="grid grid-cols-2 gap-3">
              <ZInput label="Plan order ID *" value={repinOrderId} onChange={(e) => setRepinOrderId(e.target.value)} />
              <ZInput label="Version ID *" value={repinVersionId} onChange={(e) => setRepinVersionId(e.target.value)} />
              <div className="col-span-2">
                <ZInput label="Override reason *" value={repinReason} onChange={(e) => setRepinReason(e.target.value)} />
              </div>
            </div>
            <ZButton type="button" disabled={busy} onClick={() => void repinOrder()}>Re-pin</ZButton>
          </div>
        )}
        {tab === 'qc' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <ZButton type="button" variant="secondary" disabled={!qcRows.length} onClick={exportQcCsv}>
                Export CSV
              </ZButton>
            </div>
            <div className="overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left">
                  <tr>
                    <th className="p-2">When</th>
                    <th className="p-2">Coil</th>
                    <th className="p-2">Process</th>
                    <th className="p-2">Parameter</th>
                    <th className="p-2">Value</th>
                    <th className="p-2">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {qcRows.map((r) => (
                    <tr key={r.qc_id} className="border-t">
                      <td className="p-2 text-xs">{new Date(r.measured_at).toLocaleString()}</td>
                      <td className="p-2 font-mono">{r.coil_no}</td>
                      <td className="p-2">{r.process_code}</td>
                      <td className="p-2">{r.label || r.parameter_code}</td>
                      <td className="p-2 font-mono">{r.measured_value_num ?? '—'}</td>
                      <td className="p-2 text-destructive font-medium">{r.verdict}</td>
                    </tr>
                  ))}
                  {!qcRows.length && (
                    <tr><td className="p-4 text-muted-foreground" colSpan={6}>No FAIL verdicts yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'process' && (
          <div className="space-y-4">
            <div className="border rounded-lg p-4 space-y-3 max-w-2xl">
              <p className="text-sm text-muted-foreground">
                Process sheet = where each parameter is checked. Format: PROCESS:CODE,CODE;PROCESS:CODE
              </p>
              <div className="grid grid-cols-2 gap-3">
                <ZInput label="Grade *" value={psGrade} onChange={(e) => setPsGrade(e.target.value)} />
                <ZInput label="Title" value={psTitle} onChange={(e) => setPsTitle(e.target.value)} />
                <div className="col-span-2">
                  <ZInput label="Steps" value={psSteps} onChange={(e) => setPsSteps(e.target.value)} />
                </div>
              </div>
              <ZButton type="button" disabled={busy} onClick={() => void createProcessSheet()}>
                Create + publish
              </ZButton>
            </div>
            <div className="overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left">
                  <tr>
                    <th className="p-2">Grade</th>
                    <th className="p-2">Title</th>
                    <th className="p-2">Route</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {processSheets.map((s) => (
                    <tr key={s.process_sheet_id} className="border-t">
                      <td className="p-2 font-medium">{s.grade_code}</td>
                      <td className="p-2">{s.title || '—'}</td>
                      <td className="p-2">{s.route_code || '—'}</td>
                      <td className="p-2">{s.status}</td>
                      <td className="p-2">{s.customer_name || 'default'}</td>
                    </tr>
                  ))}
                  {!processSheets.length && (
                    <tr><td className="p-4 text-muted-foreground" colSpan={5}>No process sheets yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 'catalog' && (
          <>
            <div className="border rounded-lg p-4 space-y-3 max-w-2xl">
              <p className="text-xs uppercase text-muted-foreground">Add parameter (no migration)</p>
              <div className="grid grid-cols-2 gap-3">
                <ZInput label="Code *" value={paramCode} onChange={(e) => setParamCode(e.target.value)} />
                <ZInput label="Label *" value={paramLabel} onChange={(e) => setParamLabel(e.target.value)} />
                <ZInput label="Unit" value={paramUnit} onChange={(e) => setParamUnit(e.target.value)} />
                <ZInput label="Group" value={paramGroup} onChange={(e) => setParamGroup(e.target.value)} />
                <label className="text-sm">
                  <span className="text-[10px] uppercase text-muted-foreground">Limit kind</span>
                  <select className="mt-1 h-11 w-full rounded-sm border border-input bg-background px-3"
                    value={paramKind} onChange={(e) => setParamKind(e.target.value)}>
                    {['MIN_MAX', 'MIN_ONLY', 'MAX_ONLY', 'TARGET_TOL', 'EXACT'].map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <ZInput label="Applies to (comma)" value={paramApplies} onChange={(e) => setParamApplies(e.target.value)} />
              </div>
              <ZButton type="button" disabled={busy} onClick={() => void saveParameter()}>Save parameter</ZButton>
            </div>
            <div className="overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left">
                  <tr>
                    <th className="p-2">Code</th>
                    <th className="p-2">Label</th>
                    <th className="p-2">Group</th>
                    <th className="p-2">Unit</th>
                    <th className="p-2">Limit</th>
                    <th className="p-2">Applies</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {params.map((p) => (
                    <tr key={p.parameter_code} className="border-t">
                      <td className="p-2 font-mono text-xs">{p.parameter_code}</td>
                      <td className="p-2">{p.label}</td>
                      <td className="p-2">{p.param_group || '—'}</td>
                      <td className="p-2">{p.unit || '—'}</td>
                      <td className="p-2">{p.limit_kind}</td>
                      <td className="p-2 text-xs">{(p.applies_to ?? []).join(', ') || '—'}</td>
                      <td className="p-2 text-right">
                        <ZButton type="button" variant="secondary" disabled={busy} onClick={() => void retireParameter(p.parameter_code)}>
                          Retire
                        </ZButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </QualityShell>
  );
}
