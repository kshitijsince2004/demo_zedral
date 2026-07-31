/**
 * MasterDataAdmin — `/admin/master-data`
 *
 * CRUD for all seven master-data entity types:
 *   customers, grades, surface finishes, defect codes, stoppage codes,
 *   operators, furnaces.
 *
 * Soft-delete (deactivate / reactivate):
 *   - Deactivated records are excluded from operator selection lists.
 *   - They remain visible in this admin table (with an INACTIVE badge) so
 *     historical references are preserved.
 *
 * Requirements: 7.1, 7.2
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import {
  adminService,
  type MasterEntity,
  type MasterRecord,
  MASTER_ENTITIES,
  MASTER_ENTITY_LABELS,
} from '../../services/adminService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FormMode = 'create' | 'edit';

interface FormState {
  mode: FormMode;
  entity: MasterEntity;
  record: Partial<MasterRecord>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyRecord(): Partial<MasterRecord> {
  return { code: '', name: '', description: '', isActive: true };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Inline form for creating or editing a master-data record. */
function RecordForm({
  form,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  form: FormState;
  saving: boolean;
  error: string | null;
  onChange: (field: keyof MasterRecord, value: string | boolean) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { mode, entity, record } = form;
  const title = mode === 'create' ? 'New Record' : 'Edit Record';
  const isDefectCode = entity === 'defect_code';
  const codeLabel = isDefectCode ? 'Defect code' : 'Code';
  const nameLabel = isDefectCode ? 'Defect name (operator label)' : 'Name';
  const descriptionLabel = isDefectCode ? 'Symbol (optional)' : 'Description';
  const namePlaceholder = isDefectCode ? 'e.g. Gauge Variation' : 'Display name';
  const descriptionPlaceholder = isDefectCode ? 'e.g. GV' : 'Optional description';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="h-8 w-8 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {/* Code */}
          <div className="flex flex-col gap-1">
            <label htmlFor="record-code" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {codeLabel} <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <input
              id="record-code"
              type="text"
              value={record.code ?? ''}
              onChange={(e) => onChange('code', e.target.value)}
              placeholder={isDefectCode ? 'e.g. 1' : 'e.g. IS2062'}
              className="h-14 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-required="true"
            />
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label htmlFor="record-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {nameLabel} <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <input
              id="record-name"
              type="text"
              value={record.name ?? ''}
              onChange={(e) => onChange('name', e.target.value)}
              placeholder={namePlaceholder}
              className="h-14 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-required="true"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label htmlFor="record-description" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {descriptionLabel}
            </label>
            <textarea
              id="record-description"
              value={isDefectCode ? (record.symbol ?? '') : (record.description ?? '')}
              onChange={(e) => onChange(isDefectCode ? 'symbol' : 'description', e.target.value)}
              placeholder={descriptionPlaceholder}
              rows={2}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          {/* Active toggle (edit mode only) */}
          {mode === 'edit' && (
            <div className="flex items-center gap-3">
              <button
                role="switch"
                aria-checked={record.isActive ?? true}
                onClick={() => onChange('isActive', !(record.isActive ?? true))}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                  record.isActive ? 'bg-success' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    record.isActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm text-foreground">
                {record.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <ZButton variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </ZButton>
          <ZButton
            variant="accent"
            size="md"
            onClick={onSave}
            disabled={saving || !record.code?.trim() || !record.name?.trim()}
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save Changes'}
          </ZButton>
        </div>
      </div>
    </div>
  );
}

/** Confirmation dialog for deactivate / reactivate. */
function ConfirmDialog({
  record,
  action,
  onConfirm,
  onCancel,
}: {
  record: MasterRecord;
  action: 'deactivate' | 'reactivate';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isDeactivate = action === 'deactivate';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isDeactivate ? 'Deactivate record' : 'Reactivate record'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {isDeactivate ? 'Deactivate Record' : 'Reactivate Record'}
          </h2>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted-foreground">
            {isDeactivate
              ? `Deactivating "${record.name}" will exclude it from selection lists. Historical references are preserved.`
              : `Reactivating "${record.name}" will make it available in selection lists again.`}
          </p>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <ZButton variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </ZButton>
          <ZButton variant={isDeactivate ? 'danger' : 'accent'} size="md" onClick={onConfirm}>
            {isDeactivate ? 'Deactivate' : 'Reactivate'}
          </ZButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function MasterDataAdmin() {
  // ---- State ---------------------------------------------------------------
  const [activeEntity, setActiveEntity] = useState<MasterEntity>('customer');
  const [records, setRecords] = useState<MasterRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form dialog
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Confirm dialog
  const [confirmState, setConfirmState] = useState<{
    record: MasterRecord;
    action: 'deactivate' | 'reactivate';
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // ---- Data loading --------------------------------------------------------
  const loadRecords = useCallback(async (entity: MasterEntity) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await adminService.listMaster(entity, { includeInactive: true });
      setRecords(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords(activeEntity);
  }, [activeEntity, loadRecords]);

  // ---- Entity tab switch ---------------------------------------------------
  const handleEntityChange = (entity: MasterEntity) => {
    setActiveEntity(entity);
    setFormState(null);
    setConfirmState(null);
  };

  // ---- Create / Edit -------------------------------------------------------
  const openCreate = () => {
    setFormError(null);
    setFormState({ mode: 'create', entity: activeEntity, record: emptyRecord() });
  };

  const openEdit = (record: MasterRecord) => {
    setFormError(null);
    setFormState({ mode: 'edit', entity: activeEntity, record: { ...record } });
  };

  const handleFormChange = (field: keyof MasterRecord, value: string | boolean) => {
    setFormState((prev) =>
      prev ? { ...prev, record: { ...prev.record, [field]: value } } : prev,
    );
  };

  const handleFormSave = async () => {
    if (!formState) return;
    const { entity, record } = formState;

    if (!record.code?.trim() || !record.name?.trim()) {
      setFormError('Code and Name are required.');
      return;
    }

    setFormSaving(true);
    setFormError(null);
    try {
      await adminService.upsertMaster(entity, {
        ...record,
        isActive: record.isActive ?? true,
      } as MasterRecord);

      await loadRecords(entity);
      setFormState(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setFormSaving(false);
    }
  };

  // ---- Soft-delete ---------------------------------------------------------
  const openConfirm = (record: MasterRecord) => {
    setConfirmState({
      record,
      action: record.isActive ? 'deactivate' : 'reactivate',
    });
  };

  const handleConfirm = async () => {
    if (!confirmState) return;
    const { record, action } = confirmState;
    if (!record.id) return;

    setConfirmBusy(true);
    try {
      const updated = await adminService.setMasterActive(
        activeEntity,
        record.id,
        action === 'reactivate',
      );
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setConfirmState(null);
    } catch (err) {
      // Surface error inline — keep dialog open so user can retry
      console.error('Toggle active failed:', err);
    } finally {
      setConfirmBusy(false);
    }
  };

  // ---- Render --------------------------------------------------------------
  const activeCount = records.filter((r) => r.isActive).length;
  const inactiveCount = records.length - activeCount;

  return (
    <AdminShell
      title="Master Data"
      subtitle="Reference entities for capture forms and validation"
      onRefresh={() => loadRecords(activeEntity)}
      refreshing={loading}
    >
      <AdminPanel title="Entity type">
        <div className="px-4 py-2.5 flex flex-wrap gap-1.5 items-center" role="tablist" aria-label="Master data entity types">
          {MASTER_ENTITIES.map((entity) => (
            <button
              key={entity}
              role="tab"
              aria-selected={activeEntity === entity}
              onClick={() => handleEntityChange(entity)}
              className={`h-9 rounded-sm px-3 text-[10px] font-semibold uppercase tracking-wider border transition-colors ${
                activeEntity === entity
                  ? 'border-accent/40 bg-accent/12 text-accent'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {MASTER_ENTITY_LABELS[entity]}
            </button>
          ))}
          <Link
            to="/admin/machines"
            className="h-9 rounded-sm px-3 text-[10px] font-semibold uppercase tracking-wider border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center"
          >
            Machines →
          </Link>
          <Link
            to="/admin/machine-specs"
            className="h-9 rounded-sm px-3 text-[10px] font-semibold uppercase tracking-wider border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center"
          >
            CRS Specs →
          </Link>
        </div>
      </AdminPanel>

      <AdminPanel
        title={MASTER_ENTITY_LABELS[activeEntity]}
        meta={
          <span className="text-xs text-muted-foreground">
            {activeCount} active{inactiveCount > 0 && `, ${inactiveCount} inactive`}
          </span>
        }
        actions={
          <ZButton variant="accent" size="sm" onClick={openCreate}>
            + Add record
          </ZButton>
        }
        noPadding
      >

        {/* Load error */}
        {loadError && (
          <div
            role="alert"
            className="px-5 py-3 border-b border-border bg-destructive/10 text-sm text-destructive flex items-center gap-2"
          >
            <span aria-hidden="true">⚠</span>
            {loadError}
            <button
              onClick={() => loadRecords(activeEntity)}
              className="ml-auto text-xs underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto">
          <table className="w-full" aria-label={`${MASTER_ENTITY_LABELS[activeEntity]} records`}>
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b border-border">
                <th scope="col" className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Code
                </th>
                <th scope="col" className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Name
                </th>
                <th scope="col" className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Description
                </th>
                <th scope="col" className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th scope="col" className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && records.length === 0 && !loadError && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No records found. Add the first one.
                  </td>
                </tr>
              )}
              {!loading &&
                records.map((record, index) => (
                  <tr
                    key={record.id || record.code || `${activeEntity}-${index}`}
                    className={`border-b border-border last:border-0 transition-colors ${
                      record.isActive ? 'hover:bg-secondary' : 'opacity-60 hover:bg-secondary/60'
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-info">{record.code}</td>
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{record.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">
                      {record.description || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        tone={record.isActive ? 'success' : 'muted'}
                        label={record.isActive ? 'ACTIVE' : 'INACTIVE'}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {/* Edit */}
                        <button
                          onClick={() => openEdit(record)}
                          aria-label={`Edit ${record.name}`}
                          className="h-10 rounded-md border border-input text-xs font-medium text-foreground hover:bg-secondary transition-colors px-3"
                        >
                          Edit
                        </button>
                        {/* Deactivate / Reactivate (soft-delete) */}
                        <button
                          onClick={() => openConfirm(record)}
                          aria-label={record.isActive ? `Deactivate ${record.name}` : `Reactivate ${record.name}`}
                          className={`h-10 rounded-md border text-xs font-medium transition-colors px-3 ${
                            record.isActive
                              ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
                              : 'border-success/40 text-success hover:bg-success/10'
                          }`}
                        >
                          {record.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      {/* Create / Edit dialog */}
      {formState && (
        <RecordForm
          form={formState}
          saving={formSaving}
          error={formError}
          onChange={handleFormChange}
          onSave={handleFormSave}
          onCancel={() => setFormState(null)}
        />
      )}

      {/* Confirm deactivate / reactivate dialog */}
      {confirmState && (
        <ConfirmDialog
          record={confirmState.record}
          action={confirmState.action}
          onConfirm={handleConfirm}
          onCancel={() => !confirmBusy && setConfirmState(null)}
        />
      )}
    </AdminShell>
  );
}
