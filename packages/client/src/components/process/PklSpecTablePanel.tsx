import { useCallback, useEffect, useMemo, useState } from 'react';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { apiClient } from '../../lib/apiClient';
import {
  emptyPklSpecForm,
  PKL_SPEC_PARAM_LABELS,
  PKL_SPEC_SCOPES,
  type PklSpecForm,
  type PklSpecLimit,
} from '../../lib/pklSpecLabels';
import {
  Panel,
  PanelBody,
  PanelHeader,
} from '../../pages/live/MachineHeadDashboardPanels';

type Props = {
  /** Dedicated specs page — show soft-delete */
  showDelete?: boolean;
  title?: string;
};

/** PKL spec limits — CRM Panel table + Add/Edit modal (upsert via POST). */
export function PklSpecTablePanel({ showDelete = false, title = 'PKL Specifications' }: Props) {
  const [limits, setLimits] = useState<PklSpecLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PklSpecLimit | null>(null);
  const [form, setForm] = useState<PklSpecForm>(emptyPklSpecForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ limits: PklSpecLimit[] }>('/stations/pkl/spec-limits');
      setLimits(res.limits ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(
    () => [...limits].sort((a, b) => {
      const scope = a.tank_scope.localeCompare(b.tank_scope);
      if (scope !== 0) return scope;
      return a.param_key.localeCompare(b.param_key);
    }),
    [limits],
  );

  function openAdd() {
    setEditing(null);
    setForm(emptyPklSpecForm());
    setModalOpen(true);
  }

  function openEdit(row: PklSpecLimit) {
    setEditing(row);
    setForm({
      paramKey: row.param_key,
      tankScope: row.tank_scope,
      minVal: row.min_val != null ? String(row.min_val) : '',
      maxVal: row.max_val != null ? String(row.max_val) : '',
      unit: row.unit ?? '',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyPklSpecForm());
  }

  async function saveLimit(active = true) {
    const min = form.minVal === '' ? null : Number(form.minVal);
    const max = form.maxVal === '' ? null : Number(form.maxVal);
    if (min != null && max != null && min > max) {
      setError('Min must be ≤ max');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiClient.post('/stations/pkl/spec-limits', {
        paramKey: form.paramKey,
        tankScope: form.tankScope,
        minVal: min,
        maxVal: max,
        unit: form.unit || null,
        isActive: active,
      });
      closeModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function softDelete(row: PklSpecLimit) {
    if (!window.confirm(`Remove ${PKL_SPEC_PARAM_LABELS[row.param_key] ?? row.param_key} (${row.tank_scope})?`)) return;
    setError(null);
    try {
      await apiClient.post('/stations/pkl/spec-limits', {
        paramKey: row.param_key,
        tankScope: row.tank_scope,
        isActive: false,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <>
      <Panel>
        <PanelHeader title={title}>
          <ZButton type="button" size="sm" onClick={openAdd}>+ Add</ZButton>
        </PanelHeader>
        {error && <p className="px-4 py-2 text-sm text-destructive">{error}</p>}
        {loading ? (
          <div className="p-6 space-y-2 animate-pulse" aria-busy>
            <div className="h-8 bg-muted rounded" />
            <div className="h-8 bg-muted rounded" />
            <div className="h-8 bg-muted rounded" />
          </div>
        ) : (
          <PanelBody empty={sorted.length === 0} emptyLabel="No spec limits configured">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2">Parameter</th>
                  <th>Scope</th>
                  <th className="font-mono">Min</th>
                  <th className="font-mono">Max</th>
                  <th>Unit</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={`${row.param_key}:${row.tank_scope}`} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{PKL_SPEC_PARAM_LABELS[row.param_key] ?? row.param_key}</td>
                    <td className="font-mono text-xs">{row.tank_scope}</td>
                    <td className="font-mono tabular-nums">{row.min_val ?? '—'}</td>
                    <td className="font-mono tabular-nums">{row.max_val ?? '—'}</td>
                    <td className="text-muted-foreground">{row.unit ?? '—'}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <ZButton type="button" variant="secondary" size="sm" onClick={() => openEdit(row)}>
                        Edit
                      </ZButton>
                      {showDelete && (
                        <ZButton
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="ml-2 text-destructive"
                          onClick={() => void softDelete(row)}
                        >
                          Delete
                        </ZButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelBody>
        )}
      </Panel>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div
            className="bg-background rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto shadow-lg border border-border"
            role="dialog"
            aria-labelledby="pkl-spec-modal-title"
          >
            <h3 id="pkl-spec-modal-title" className="font-bold text-foreground">
              {editing ? 'Edit specification' : 'Add specification'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Parameter</p>
                <select
                  className="w-full min-h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  value={form.paramKey}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, paramKey: e.target.value })}
                >
                  {Object.keys(PKL_SPEC_PARAM_LABELS).map((k) => (
                    <option key={k} value={k}>{PKL_SPEC_PARAM_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Scope</p>
                <select
                  className="w-full min-h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  value={form.tankScope}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, tankScope: e.target.value })}
                >
                  {PKL_SPEC_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <ZInput label="Min" value={form.minVal} onChange={(e) => setForm({ ...form, minVal: e.target.value })} />
              <ZInput label="Max" value={form.maxVal} onChange={(e) => setForm({ ...form, maxVal: e.target.value })} />
              <ZInput label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>
            <div className="flex gap-2 justify-end">
              <ZButton type="button" variant="secondary" onClick={closeModal} disabled={saving}>Cancel</ZButton>
              <ZButton type="button" onClick={() => void saveLimit(true)} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
              </ZButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
