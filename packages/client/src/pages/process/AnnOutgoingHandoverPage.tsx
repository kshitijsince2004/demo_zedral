import { useCallback, useState } from 'react';
import { Clock } from 'lucide-react';
import { AnnShiftReviewPanel } from '../../components/process/AnnShiftReviewPanel';
import {
  HandoverLockedField,
  HandoverSectionHeader,
  ProcessOutgoingHandoverShell,
} from '../../components/process/ProcessOutgoingHandoverShell';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { useHandoverPreview } from '../../hooks/useHandoverState';
import { useShiftStore } from '../../store/shiftStore';
import type { PendingHandover, HandoverPreview } from '../../services/machineHandoverService';

/** ANN outgoing handover — shift summary + AnnShiftReviewPanel inside shared shell. */
export function AnnOutgoingHandoverPage() {
  const annShiftLogId = useShiftStore((s) => s.shiftLogId);
  const { data: preview } = useHandoverPreview('ANN');
  const [annRemarks, setAnnRemarks] = useState('');

  const hydrateExtra = useCallback((draft: PendingHandover | null | undefined, _preview: HandoverPreview | null | undefined) => {
    if (!draft) return;
    const ps = draft.production_snapshot as Record<string, unknown>;
    const sm = ps?.shiftManualFields as Record<string, unknown> | null;
    if (sm?.shiftRemarks != null) setAnnRemarks(String(sm.shiftRemarks ?? ''));
  }, []);

  const p = preview ?? {
    machineName: 'Annealing',
    processCode: 'ANN',
    shift: {
      shiftCode: '—', prodDate: '—',
      windowStart: undefined as string | undefined,
      windowEnd: undefined as string | undefined,
      actualSessionStartAt: undefined as string | undefined,
    },
    nextShift: { shiftCode: '—', prodDate: '—' },
  };

  return (
    <ProcessOutgoingHandoverShell
      machineCode="ANN"
      title={p.machineName ?? 'Annealing'}
      loadingLabel="Loading ANN handover…"
      extraPayload={{ shiftRemarks: annRemarks || undefined }}
      hydrateExtra={hydrateExtra}
      footerLabels={{ submit: 'Submit Handover & Sign Out' }}
      notesExtra={(
        <div className="mb-3">
          <label className="block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-1.5">
            Shift Remarks
          </label>
          <textarea
            className="w-full min-h-[44px] rounded-lg border border-input bg-background px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={annRemarks}
            onChange={(e) => setAnnRemarks(e.target.value)}
            rows={2}
            placeholder="Shift remarks for review panel…"
          />
        </div>
      )}
    >
      <section className="rounded-lg border border-border bg-card p-5">
        <HandoverSectionHeader icon={<Clock className="h-4 w-4" />} title="Shift Summary" locked />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <HandoverLockedField label="Date" value={p.shift.prodDate} />
          <HandoverLockedField label="Shift" value={p.shift.shiftCode} />
          <HandoverLockedField label="Machine" value={p.machineName ?? 'Annealing'} />
          <HandoverLockedField label="Process" value={p.processCode ?? 'ANN'} />
          <HandoverLockedField
            label="Scheduled Shift Start"
            value={p.shift.windowStart ? formatPlantDateTime(p.shift.windowStart) : '—'}
          />
          <HandoverLockedField
            label="Scheduled Shift End"
            value={p.shift.windowEnd ? formatPlantDateTime(p.shift.windowEnd) : '—'}
          />
          <HandoverLockedField
            label="Actual Session Start"
            value={p.shift.actualSessionStartAt ? formatPlantDateTime(p.shift.actualSessionStartAt) : '—'}
          />
          <HandoverLockedField label="Next Shift" value={p.nextShift.shiftCode} />
          <HandoverLockedField label="Next Shift Date" value={p.nextShift.prodDate} />
        </div>
      </section>

      <AnnShiftReviewPanel
        shiftLogId={annShiftLogId}
        remarks={annRemarks}
        onRemarksChange={setAnnRemarks}
      />
    </ProcessOutgoingHandoverShell>
  );
}
