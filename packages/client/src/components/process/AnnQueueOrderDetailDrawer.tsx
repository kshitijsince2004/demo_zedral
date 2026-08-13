import { useEffect, useState } from 'react';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { processQueueStatusLabel, type ProcessQueueCard } from '../../store/processStore';
import { apiClient } from '../../lib/apiClient';
import { ZDrawer } from '../primitives/ZDrawer';

type DetailField = { label: string; value: string; mono?: boolean };
type DetailSection = { id: string; title: string; fields: DetailField[] };

type AnnQueueOrderDetail = {
  coilNo: string;
  displayCoilNo?: string;
  status?: string;
  sections: DetailSection[];
};

interface AnnQueueOrderDetailDrawerProps {
  card: ProcessQueueCard | null;
  open: boolean;
  onClose: () => void;
}

function DetailSections({ sections }: { sections: DetailSection[] }) {
  if (sections.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">No plan details found for this coil.</p>
    );
  }
  return (
    <div className="space-y-4 px-4 py-3">
      {sections.map((section) => (
        <section key={section.id}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            {section.title}
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {section.fields.map((f) => (
              <div key={`${section.id}-${f.label}`} className={f.label.length > 24 ? 'col-span-2' : undefined}>
                <dt className="text-muted-foreground text-[11px] uppercase tracking-wide leading-tight font-semibold">
                  {f.label}
                </dt>
                <dd className={`font-bold mt-1 text-sm leading-snug text-foreground break-words ${f.mono ? 'font-mono tabular-nums' : ''}`}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Read-only ANN queue order details — loads full plan/recipe from server. */
export function AnnQueueOrderDetailDrawer({ card, open, onClose }: AnnQueueOrderDetailDrawerProps) {
  const [detail, setDetail] = useState<AnnQueueOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !card?.coilNo) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void apiClient
      .get<AnnQueueOrderDetail>(`/stations/ann/queue/${encodeURIComponent(card.coilNo)}/detail`)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setError(e instanceof Error ? e.message : 'Failed to load order details');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, card?.coilNo]);

  const title = card ? displayMotherCoilId(card) : 'Order details';
  const statusLabel = card ? processQueueStatusLabel(card.status) : '';

  return (
    <ZDrawer open={open && !!card} onClose={onClose} title="Order details" size="large">
      {card ? (
        <div className="flex flex-col h-full min-h-0">
          <div className="shrink-0 px-4 pt-3 pb-3 border-b border-border/60">
            <h2 className="font-mono text-xl font-bold text-foreground truncate">{title}</h2>
            {card.batchNumber ? (
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-1">
                Batch {card.batchNumber}
              </p>
            ) : null}
            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {statusLabel}
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading && (
              <p className="px-4 py-6 text-sm text-muted-foreground">Loading plan & recipe…</p>
            )}
            {error && !loading && (
              <p className="px-4 py-6 text-sm text-destructive">{error}</p>
            )}
            {!loading && !error && detail && (
              <DetailSections sections={detail.sections} />
            )}
            {!loading && !error && !detail && (
              <p className="px-4 py-6 text-sm text-muted-foreground">No details available.</p>
            )}
          </div>
        </div>
      ) : null}
    </ZDrawer>
  );
}
