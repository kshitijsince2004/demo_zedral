/**
 * ChangeRequestPanel — Change-request flow for locked shift logs.
 *
 * Rendered inside the ReviewSubmit/ShiftLogShell when a shift log is in
 * SUBMITTED or APPROVED state. Operators cannot edit fields directly;
 * instead they raise a change request with a mandatory reason.
 *
 * Supervisors see the same panel with Approve/Reject controls on each pending CR.
 *
 * Requirements: 6.4, 6.6
 */

import React, { useEffect, useState, useCallback } from 'react';
import { StatusBadge } from '../ui/StatusBadge';
import { useGloveModeClasses } from '../../hooks/useGloveModeClasses';
import { useAuthStore } from '../../lib/authStore';
import {
  changeRequestService,
  type ChangeRequest,
  type ChangeRequestStatus,
} from '../../services/changeRequestService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function crStatusTone(status: ChangeRequestStatus): 'warning' | 'success' | 'destructive' | 'muted' {
  switch (status) {
    case 'PENDING': return 'warning';
    case 'APPROVED':
    case 'APPLIED': return 'success';
    case 'REJECTED': return 'destructive';
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ChangeRequestPanelProps {
  /** The shift log ID this panel is associated with. */
  shiftLogId: string;
  /**
   * Current state of the shift log: SUBMITTED or APPROVED.
   * DRAFT/REOPENED logs do not render this panel.
   */
  shiftLogState: 'SUBMITTED' | 'APPROVED';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChangeRequestPanel({ shiftLogId, shiftLogState }: ChangeRequestPanelProps) {
  const { role } = useAuthStore();
  const { saveHeight, inputFieldHeight, controlGap } = useGloveModeClasses();

  const canViewChangeRequests = role === 'SUPERVISOR' || role === 'PLANT_HEAD' || role === 'ADMIN';
  const canActOnChangeRequests = role === 'SUPERVISOR' || role === 'ADMIN';
  const isViewOnlyPlantHead = role === 'PLANT_HEAD';

  // ── State ──────────────────────────────────────────────────────────────────
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New CR form
  const [reason, setReason] = useState('');
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Rejection note for supervisor
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

  // ── Load CRs ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await changeRequestService.listForShiftLog(shiftLogId);
      setRequests(list);
    } catch (err: any) {
      setError(err?.message ?? 'Unable to load change requests');
    } finally {
      setLoading(false);
    }
  }, [shiftLogId]);

  useEffect(() => { load(); }, [load]);

  // ── Submit new CR ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setSubmitStatus('submitting');
    setSubmitError(null);
    try {
      await changeRequestService.create({
        shiftLogId,
        reason: reason.trim(),
        proposedChanges: {}, // Operator describes the change in text; supervisor reviews the log
      });
      setSubmitStatus('submitted');
      setReason('');
      await load();
    } catch (err: any) {
      setSubmitStatus('failed');
      setSubmitError(err?.message ?? 'Failed to submit change request');
    }
  };

  // ── Supervisor actions ────────────────────────────────────────────────────
  const handleApprove = async (cr: ChangeRequest) => {
    try {
      await changeRequestService.approve(cr.id);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to approve change request');
    }
  };

  const handleReject = async (cr: ChangeRequest) => {
    const note = rejectNotes[cr.id] ?? '';
    try {
      await changeRequestService.reject(cr.id, note);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to reject change request');
    }
  };

  const pendingCount = requests.filter(r => r.status === 'PENDING').length;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider font-medium text-muted-foreground">
            Change Requests
          </span>
          {pendingCount > 0 && (
            <StatusBadge tone="warning" label={`${pendingCount} Pending`} />
          )}
        </div>
        <StatusBadge
          tone={shiftLogState === 'APPROVED' ? 'success' : 'warning'}
          label={shiftLogState}
        />
      </div>

      <div className="p-5 flex flex-col gap-5">
        {/* Edit lock notice */}
        <div className={`px-4 py-3 rounded-md border ${
          shiftLogState === 'APPROVED'
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-warning/30 bg-warning/10 text-warning'
        }`}>
          <div className="text-sm font-medium">
            {shiftLogState === 'APPROVED'
              ? '✓ This shift log has been approved. Raise a change request to request modifications.'
              : '⚠ This shift log is submitted for review. Direct edits are locked until reopened.'}
          </div>
        </div>

        {/* Existing CRs */}
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-4">Loading change requests…</div>
        ) : error ? (
          <div className="text-sm text-destructive text-center py-4">⚠ {error}</div>
        ) : requests.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Previous Requests
            </div>
            {requests.map((cr) => (
              <div
                key={cr.id}
                className="rounded-md border border-border bg-muted/20 overflow-hidden"
              >
                <div className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1 flex-1">
                    <div className="text-sm font-medium">{cr.reason}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {new Date(cr.createdAt).toLocaleString()}
                    </div>
                    {cr.rejectionNote && (
                      <div className="text-xs text-destructive mt-1">
                        Rejection note: {cr.rejectionNote}
                      </div>
                    )}
                  </div>
                  <StatusBadge tone={crStatusTone(cr.status)} label={cr.status} />
                </div>

                {isViewOnlyPlantHead && cr.status === 'PENDING' && (
                  <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground italic">
                    View only — Plant head cannot approve or reject change requests.
                  </div>
                )}

                {/* Supervisor approve/reject controls for PENDING CRs */}
                {canActOnChangeRequests && cr.status === 'PENDING' && (
                  <div className="border-t border-border px-4 pb-4 pt-3 flex flex-col gap-3">
                    <input
                      type="text"
                      placeholder="Rejection note (required to reject)"
                      value={rejectNotes[cr.id] ?? ''}
                      onChange={(e) =>
                        setRejectNotes((prev) => ({ ...prev, [cr.id]: e.target.value }))
                      }
                      className={`${inputFieldHeight} w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
                    />
                    <div className={`flex ${controlGap}`}>
                      <button
                        onClick={() => handleApprove(cr)}
                        className={`${saveHeight} flex-1 rounded-md bg-success text-success-foreground text-sm font-semibold hover:bg-success/90 transition-colors`}
                      >
                        ✓ Approve CR
                      </button>
                      <button
                        onClick={() => handleReject(cr)}
                        disabled={!(rejectNotes[cr.id] ?? '').trim()}
                        className={`${saveHeight} flex-1 rounded-md bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        ✗ Reject CR
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-2">
            No change requests for this shift log.
          </div>
        )}

        {/* New CR form — operators only (supervisors approve/reject, not submit) */}
        {!canViewChangeRequests && (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Request a Change
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (submitStatus !== 'idle') setSubmitStatus('idle');
                }}
                placeholder="Describe the change needed and why (required)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 resize-none"
              />
            </div>

            {submitError && (
              <div className="text-xs text-destructive font-medium">⚠ {submitError}</div>
            )}
            {submitStatus === 'submitted' && (
              <StatusBadge tone="success" label="Change request submitted" />
            )}

            <button
              onClick={handleSubmit}
              disabled={!reason.trim() || submitStatus === 'submitting'}
              className={`${saveHeight} rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {submitStatus === 'submitting' ? '…Submitting' : '↑ Submit Change Request'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
