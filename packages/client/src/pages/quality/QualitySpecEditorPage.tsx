import { useCallback, useEffect, useMemo, useState } from 'react';

import { Link, useNavigate, useParams } from 'react-router-dom';

import { QualityShell } from '../../components/layout/quality/QualityShell';

import { ZButton } from '../../components/primitives/ZButton';

import { ZInput } from '../../components/primitives/ZInput';

import { apiClient } from '../../lib/apiClient';



interface SpecSheet {

  spec_sheet_id: number;

  grade_code: string;

  material_code: string;

  surface_finish?: string | null;

  width_mm?: number | null;

  finish_thk_mm?: number | null;

  length_mm?: number | null;

  customer_id?: number | null;

  customer_name?: string | null;

  title?: string | null;

}



interface VersionRow {

  version_id: number;

  version_no: number;

  status: string;

  effective_from?: string | null;

  effective_to?: string | null;

  created_by?: string | null;

  approved_by?: string | null;

  notes?: string | null;

  created_at?: string;

}



interface ParamCatalog {

  parameter_code: string;

  label: string;

  unit?: string | null;

  limit_kind: string;

  param_group?: string | null;

  data_type: string;

}



interface ValueRow {

  parameter_code: string;

  label?: string;

  unit?: string | null;

  limit_kind?: string;

  min_value?: number | null;

  max_value?: number | null;

  target_value?: number | null;

  tolerance?: number | null;

  text_value?: string | null;

  is_mandatory?: boolean;

}



type DraftValue = {

  parameterCode: string;

  minValue: string;

  maxValue: string;

  targetValue: string;

  tolerance: string;

  textValue: string;

  isMandatory: boolean;

  limitKind: string;

  label: string;

  unit: string;

};



function toDraft(v: ValueRow, catalog?: ParamCatalog): DraftValue {

  const kind = v.limit_kind ?? catalog?.limit_kind ?? 'MIN_MAX';

  return {

    parameterCode: v.parameter_code,

    minValue: v.min_value != null ? String(v.min_value) : '',

    maxValue: v.max_value != null ? String(v.max_value) : '',

    targetValue: v.target_value != null ? String(v.target_value) : '',

    tolerance: v.tolerance != null ? String(v.tolerance) : '',

    textValue: v.text_value ?? '',

    isMandatory: Boolean(v.is_mandatory),

    limitKind: kind,

    label: v.label ?? catalog?.label ?? v.parameter_code,

    unit: v.unit ?? catalog?.unit ?? '',

  };

}



export function QualitySpecEditorPage() {

  const { id } = useParams();

  const navigate = useNavigate();

  const specId = Number(id);



  const [sheet, setSheet] = useState<SpecSheet | null>(null);

  const [versions, setVersions] = useState<VersionRow[]>([]);

  const [catalog, setCatalog] = useState<ParamCatalog[]>([]);

  const [versionId, setVersionId] = useState<number | null>(null);

  const [status, setStatus] = useState<string>('');

  const [drafts, setDrafts] = useState<DraftValue[]>([]);

  const [activeMap, setActiveMap] = useState<Record<string, ValueRow>>({});

  const [whereUsed, setWhereUsed] = useState<{

    orderCount: number;

    qcCount: number;

    orders?: Array<{ plan_order_id: string | number; override_reason?: string | null }>;

    qc?: Array<{ coil_no: string; parameter_code: string; verdict: string }>;

  } | null>(null);

  const [addCode, setAddCode] = useState('');

  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);



  const editable = status === 'DRAFT';

  const catalogByCode = useMemo(() => {

    const m: Record<string, ParamCatalog> = {};

    for (const p of catalog) m[p.parameter_code] = p;

    return m;

  }, [catalog]);



  const loadSpec = useCallback(async () => {

    const detail = await apiClient.get<{ sheet: SpecSheet; versions: VersionRow[] }>(`/quality/specs/${specId}`);

    setSheet(detail.sheet);

    setVersions(detail.versions);

    const preferred =

      detail.versions.find((v) => v.status === 'DRAFT') ??

      detail.versions.find((v) => v.status === 'ACTIVE') ??

      detail.versions[0];

    if (preferred) setVersionId(Number(preferred.version_id));

  }, [specId]);



  const loadVersion = useCallback(async (vid: number) => {

    const detail = await apiClient.get<{

      version: VersionRow;

      values: ValueRow[];

      activeValues: ValueRow[];

    }>(`/quality/versions/${vid}`);

    setStatus(detail.version.status);

    setNotes(detail.version.notes ?? '');

    setDrafts(detail.values.map((v) => toDraft(v, catalogByCode[v.parameter_code])));

    const am: Record<string, ValueRow> = {};

    for (const v of detail.activeValues ?? []) am[v.parameter_code] = v;

    setActiveMap(am);

    try {

      const used = await apiClient.get<{ orderCount: number; qcCount: number }>(

        `/quality/versions/${vid}/where-used`,

      );

      setWhereUsed(used);

    } catch {

      setWhereUsed(null);

    }

  }, [catalogByCode]);



  useEffect(() => {

    void (async () => {

      setError(null);

      try {

        const params = await apiClient.get<ParamCatalog[]>('/quality/parameters');

        setCatalog(params);

        await loadSpec();

      } catch (e) {

        setError(e instanceof Error ? e.message : 'Failed to load spec');

      }

    })();

  }, [loadSpec]);



  useEffect(() => {

    if (versionId != null) void loadVersion(versionId).catch((e) => setError(e instanceof Error ? e.message : 'Load failed'));

  }, [versionId, loadVersion]);



  function updateDraft(code: string, patch: Partial<DraftValue>) {

    setDrafts((rows) => rows.map((r) => (r.parameterCode === code ? { ...r, ...patch } : r)));

  }



  function addParameter() {

    if (!addCode || drafts.some((d) => d.parameterCode === addCode)) return;

    const p = catalogByCode[addCode];

    if (!p) return;

    setDrafts((rows) => [

      ...rows,

      toDraft({ parameter_code: p.parameter_code, limit_kind: p.limit_kind, label: p.label, unit: p.unit }, p),

    ]);

    setAddCode('');

  }



  function removeParameter(code: string) {

    setDrafts((rows) => rows.filter((r) => r.parameterCode !== code));

  }



  async function saveDraft() {

    if (versionId == null || !editable) return;

    setBusy(true);

    setError(null);

    try {

      await apiClient.put(`/quality/versions/${versionId}`, {

        values: drafts.map((d) => ({

          parameterCode: d.parameterCode,

          minValue: d.minValue === '' ? null : Number(d.minValue),

          maxValue: d.maxValue === '' ? null : Number(d.maxValue),

          targetValue: d.targetValue === '' ? null : Number(d.targetValue),

          tolerance: d.tolerance === '' ? null : Number(d.tolerance),

          textValue: d.textValue || null,

          isMandatory: d.isMandatory,

        })),

      });

      await loadVersion(versionId);

    } catch (e) {

      setError(e instanceof Error ? e.message : 'Save failed');

    } finally {

      setBusy(false);

    }

  }



  async function publish() {

    if (versionId == null || !editable) return;

    if (!window.confirm('Publish this DRAFT? It will supersede the current ACTIVE version.')) return;

    setBusy(true);

    setError(null);

    try {

      await apiClient.put(`/quality/versions/${versionId}`, {

        values: drafts.map((d) => ({

          parameterCode: d.parameterCode,

          minValue: d.minValue === '' ? null : Number(d.minValue),

          maxValue: d.maxValue === '' ? null : Number(d.maxValue),

          targetValue: d.targetValue === '' ? null : Number(d.targetValue),

          tolerance: d.tolerance === '' ? null : Number(d.tolerance),

          textValue: d.textValue || null,

          isMandatory: d.isMandatory,

        })),

      });

      await apiClient.post(`/quality/versions/${versionId}/publish`, {});

      await loadSpec();

      await loadVersion(versionId);

    } catch (e) {

      setError(e instanceof Error ? e.message : 'Publish failed');

    } finally {

      setBusy(false);

    }

  }



  async function retireSpec() {

    if (!sheet) return;

    if (!window.confirm(`Retire spec for ${sheet.grade_code}? Soft-delete; snapshots stay.`)) return;

    const typed = window.prompt(`Type ${sheet.grade_code} to confirm`);

    if (typed !== sheet.grade_code) {

      setError('Confirmation did not match');

      return;

    }

    setBusy(true);

    setError(null);

    try {

      await apiClient.post(`/quality/specs/${specId}/retire`, { confirm: sheet.grade_code });

      navigate('/quality/specs');

    } catch (e) {

      setError(e instanceof Error ? e.message : 'Retire failed');

    } finally {

      setBusy(false);

    }

  }



  async function newDraft() {

    setBusy(true);

    setError(null);

    try {

      const active = versions.find((v) => v.status === 'ACTIVE');

      const created = await apiClient.post<VersionRow>(`/quality/specs/${specId}/versions`, {

        notes: notes || undefined,

        copyFromVersionId: active?.version_id ?? versionId ?? undefined,

      });

      await loadSpec();

      setVersionId(Number(created.version_id));

    } catch (e) {

      setError(e instanceof Error ? e.message : 'Could not create draft');

    } finally {

      setBusy(false);

    }

  }



  if (!sheet) {

    return (

      <QualityShell title="Spec editor">

        <div className="p-4">{error ?? 'Loading…'}</div>

      </QualityShell>

    );

  }



  const unusedParams = catalog.filter((p) => !drafts.some((d) => d.parameterCode === p.parameter_code));



  return (

    <QualityShell title={`Spec · ${sheet.grade_code}`}>

      <div className="space-y-4 p-4">

        <div className="flex flex-wrap gap-2 items-center">

          <Link to="/quality/specs" className="text-sm underline text-muted-foreground">← Specs</Link>

          <span className={`text-xs px-2 py-1 rounded ${status === 'ACTIVE' ? 'bg-success/15 text-success' : status === 'DRAFT' ? 'bg-warning/15 text-warning' : 'bg-muted'}`}>

            {status || '—'}

          </span>

          {whereUsed && (

            <span className="text-xs text-muted-foreground">

              Where-used: {whereUsed.orderCount} orders · {whereUsed.qcCount} QC

            </span>

          )}

          <div className="ml-auto flex gap-2">

            <ZButton type="button" variant="secondary" disabled={busy} onClick={() => void retireSpec()}>Retire sheet</ZButton>

            <ZButton type="button" variant="secondary" disabled={busy} onClick={() => void newDraft()}>New draft</ZButton>

            {editable && (

              <>

                <ZButton type="button" variant="secondary" disabled={busy} onClick={() => void saveDraft()}>Save draft</ZButton>

                <ZButton type="button" disabled={busy} onClick={() => void publish()}>Publish</ZButton>

              </>

            )}

          </div>

        </div>



        {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}



        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">

          <ReadOnly label="Grade" value={sheet.grade_code} />

          <ReadOnly label="Material" value={sheet.material_code || '—'} />

          <ReadOnly label="Customer" value={sheet.customer_name || 'default'} />

          <ReadOnly label="Surface" value={sheet.surface_finish || '—'} />

          <ReadOnly label="Width" value={sheet.width_mm ?? '—'} />

          <ReadOnly label="Finish thk" value={sheet.finish_thk_mm ?? '—'} />

          <ReadOnly label="Length" value={sheet.length_mm ?? '—'} />

          <ReadOnly label="Title" value={sheet.title || '—'} />

        </div>



        <div className="border rounded-lg p-3 space-y-2">

          <p className="text-xs uppercase text-muted-foreground">Version history</p>

          <div className="flex flex-wrap gap-2">

            {versions.map((v) => (

              <button

                key={v.version_id}

                type="button"

                className={`text-xs px-3 py-2 rounded border ${Number(v.version_id) === versionId ? 'border-accent bg-accent/10' : 'border-border'}`}

                onClick={() => setVersionId(Number(v.version_id))}

              >

                v{v.version_no} · {v.status}

              </button>

            ))}

          </div>

        </div>



        {whereUsed && (whereUsed.orders?.length || whereUsed.qc?.length) ? (

          <div className="border rounded-lg p-3 space-y-2 text-sm">

            <p className="text-xs uppercase text-muted-foreground">Where-used detail</p>

            {!!whereUsed.orders?.length && (

              <div>

                <p className="font-medium text-xs mb-1">Orders (sample)</p>

                <ul className="text-xs space-y-1">

                  {whereUsed.orders.slice(0, 10).map((o) => (

                    <li key={String(o.plan_order_id)} className="font-mono">

                      #{o.plan_order_id}{o.override_reason ? ` · override: ${o.override_reason}` : ''}

                    </li>

                  ))}

                </ul>

              </div>

            )}

            {!!whereUsed.qc?.length && (

              <div>

                <p className="font-medium text-xs mb-1">Recent QC</p>

                <ul className="text-xs space-y-1">

                  {whereUsed.qc.slice(0, 10).map((q, i) => (

                    <li key={`${q.coil_no}-${q.parameter_code}-${i}`}>

                      {q.coil_no} · {q.parameter_code} · {q.verdict}

                    </li>

                  ))}

                </ul>

              </div>

            )}

          </div>

        ) : null}



        {editable && (

          <div className="flex gap-2 items-end">

            <label className="flex-1 text-sm">

              <span className="text-[10px] uppercase text-muted-foreground">Add parameter from catalog</span>

              <select

                className="mt-1 h-11 w-full rounded-sm border border-input bg-background px-3"

                value={addCode}

                onChange={(e) => setAddCode(e.target.value)}

              >

                <option value="">Select…</option>

                {unusedParams.map((p) => (

                  <option key={p.parameter_code} value={p.parameter_code}>

                    {p.param_group ? `${p.param_group} · ` : ''}{p.label} ({p.parameter_code})

                  </option>

                ))}

              </select>

            </label>

            <ZButton type="button" variant="secondary" onClick={addParameter}>Add</ZButton>

          </div>

        )}



        <div className="space-y-3">

          {drafts.map((d) => {

            const active = activeMap[d.parameterCode];

            return (

              <div key={d.parameterCode} className="border rounded-lg p-3 space-y-2">

                <div className="flex items-center gap-2">

                  <p className="font-medium text-sm">{d.label}</p>

                  <span className="text-[10px] font-mono text-muted-foreground">{d.parameterCode}</span>

                  {d.unit && <span className="text-xs text-muted-foreground">{d.unit}</span>}

                  {active && (

                    <span className="text-[10px] text-muted-foreground ml-auto">

                      active: {fmtLimit(active)}

                    </span>

                  )}

                  {editable && (

                    <ZButton type="button" variant="secondary" className="ml-auto" onClick={() => removeParameter(d.parameterCode)}>

                      Remove

                    </ZButton>

                  )}

                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">

                  {(d.limitKind === 'MIN_MAX' || d.limitKind === 'MIN_ONLY') && (

                    <ZInput label="Min" type="number" disabled={!editable} value={d.minValue}

                      onChange={(e) => updateDraft(d.parameterCode, { minValue: e.target.value })} />

                  )}

                  {(d.limitKind === 'MIN_MAX' || d.limitKind === 'MAX_ONLY') && (

                    <ZInput label="Max" type="number" disabled={!editable} value={d.maxValue}

                      onChange={(e) => updateDraft(d.parameterCode, { maxValue: e.target.value })} />

                  )}

                  {(d.limitKind === 'TARGET_TOL' || d.limitKind === 'EXACT') && d.limitKind !== 'EXACT' && (

                    <>

                      <ZInput label="Target" type="number" disabled={!editable} value={d.targetValue}

                        onChange={(e) => updateDraft(d.parameterCode, { targetValue: e.target.value })} />

                      <ZInput label="Tolerance" type="number" disabled={!editable} value={d.tolerance}

                        onChange={(e) => updateDraft(d.parameterCode, { tolerance: e.target.value })} />

                    </>

                  )}

                  {d.limitKind === 'EXACT' && (

                    <>

                      <ZInput label="Target / Exact" disabled={!editable} value={d.targetValue || d.textValue}

                        onChange={(e) => updateDraft(d.parameterCode, { targetValue: e.target.value, textValue: e.target.value })} />

                    </>

                  )}

                  <label className="flex items-center gap-2 text-sm pt-6">

                    <input type="checkbox" disabled={!editable} checked={d.isMandatory}

                      onChange={(e) => updateDraft(d.parameterCode, { isMandatory: e.target.checked })} />

                    Mandatory

                  </label>

                </div>

              </div>

            );

          })}

          {!drafts.length && <p className="text-sm text-muted-foreground">No parameters on this version yet.</p>}

        </div>



        <div className="flex gap-2">

          <ZButton type="button" variant="secondary" onClick={() => navigate('/quality/specs')}>Back</ZButton>

        </div>

      </div>

    </QualityShell>

  );

}



function fmtLimit(v: ValueRow): string {

  const parts = [

    v.min_value != null ? `min ${v.min_value}` : null,

    v.max_value != null ? `max ${v.max_value}` : null,

    v.target_value != null ? `tgt ${v.target_value}` : null,

    v.text_value || null,

  ].filter(Boolean);

  return parts.join(', ') || '—';

}



function ReadOnly({ label, value }: { label: string; value: string | number }) {

  return (

    <div className="bg-secondary/40 rounded-lg px-3 py-2">

      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>

      <p className="font-semibold">{value}</p>

    </div>

  );

}

