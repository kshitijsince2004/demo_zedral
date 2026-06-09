import { X } from 'lucide-react';
import type { LiveOrderDetail } from '@m1/shared-validation';
import { ProcessRouteTimeline } from './ProcessRouteTimeline';
import { ZBadge } from '../primitives/ZBadge';

interface OrderDetailModalProps {
  order: LiveOrderDetail | null;
  open: boolean;
  onClose: () => void;
  loading?: boolean;
}

function statusTone(status: string) {
  if (status === 'IN_PROGRESS' || status === 'PREPARING') return 'info' as const;
  if (status === 'STOPPAGE') return 'warning' as const;
  if (status === 'COMPLETED') return 'success' as const;
  return 'muted' as const;
}

export function OrderDetailModal({ order, open, onClose, loading }: OrderDetailModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-12">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      
      <div
        className="relative bg-background border border-border shadow-2xl rounded-2xl w-full max-w-4xl max-h-full flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-label="Order detail"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-muted/20">
          <div>
            <h2 className="font-bold text-xl font-mono">{order?.batchNumber ?? 'Loading…'}</h2>
            {order && (
              <p className="text-sm text-muted-foreground">{order.customer} · {order.grade}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted/80 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-secondary/30">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center space-y-4">
              <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground font-medium">Loading order details…</p>
            </div>
          )}

          {order && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Main Column - Journey & Primary Details */}
              <div className="lg:col-span-2 space-y-6">
                <section className="bg-background rounded-2xl border border-border p-5 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Order Journey Progress</h3>
                  <ProcessRouteTimeline steps={order.journey?.steps ?? []} direction="horizontal" />
                </section>

                <section className="bg-background rounded-2xl border border-border p-5 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">PPC Specifications</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div className="col-span-2 sm:col-span-4">
                      <span className="text-muted-foreground text-xs block mb-1">Process Route</span>
                      <p className="font-medium bg-secondary/50 px-3 py-2 rounded-lg inline-block">{order.processRouteLabels ?? '—'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Planned Weight</span>
                      <p className="font-mono text-base">{order.weightMt} MT</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Target Thickness</span>
                      <p className="font-mono text-base">{order.targetThkMm} mm</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Width</span>
                      <p className="font-mono text-base">{order.widthMm} mm</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Current Shift</span>
                      <p className="font-medium">{order.currentShiftWindow ?? '—'}</p>
                    </div>
                  </div>
                </section>
                
                {order.stoppages.length > 0 && (
                  <section className="bg-background rounded-2xl border border-border p-5 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-warning flex items-center gap-2 mb-4">
                      <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                      Stoppages ({order.stoppages.length})
                    </h3>
                    <ul className="space-y-3">
                      {order.stoppages.map((s) => (
                        <li key={s.id} className="text-sm border border-warning/20 bg-warning/5 rounded-xl p-3 flex justify-between items-start">
                          <div>
                            <span className="font-bold text-foreground">{s.category}</span>
                            {s.breakdownCode && <span className="text-muted-foreground"> · {s.breakdownCode}</span>}
                          </div>
                          <div className="text-right text-muted-foreground font-mono text-xs">
                            {new Date(s.startAt).toLocaleTimeString()}
                            {s.durationMin != null && <span className="font-bold text-warning ml-2">{s.durationMin}m delay</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>

              {/* Sidebar Column - Current Prod & IDs */}
              <div className="space-y-6">
                <section className="bg-background rounded-2xl border border-border overflow-hidden shadow-sm">
                  <div className="bg-muted/30 px-4 py-3 border-b border-border">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Current Production</h3>
                  </div>
                  <div className="p-4 space-y-4 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Status</span>
                      <ZBadge tone={statusTone(order.status)} label={order.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">Machine</span>
                        <span className="font-medium">{order.machineName}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">Process</span>
                        <span>{order.currentProcess}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">Operator</span>
                        <span>{order.operatorName ?? '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">Shift Code</span>
                        <span className="font-mono">{order.shiftCode ?? '—'}</span>
                      </div>
                    </div>
                    {order.runtimeMin != null && (
                      <div className="pt-2 mt-2 border-t border-border">
                        <span className="text-muted-foreground text-xs block mb-1">Runtime</span>
                        <span className="font-mono text-lg text-primary">{order.runtimeMin} min</span>
                      </div>
                    )}
                  </div>
                </section>

                <section className="bg-background rounded-2xl border border-border p-4 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Identifiers</h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs block mb-0.5">Coil Number</span>
                      <p className="font-mono font-bold text-base">{order.coilNo}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs block mb-0.5">SAP Order</span>
                      <p className="font-mono">{order.sapOrderNo ?? '—'}</p>
                    </div>
                  </div>
                </section>

                {order.remarks.length > 0 && (
                  <section className="bg-background rounded-2xl border border-border p-4 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                      Remarks ({order.remarks.length})
                    </h3>
                    <ul className="space-y-3">
                      {order.remarks.map((r) => (
                        <li key={r.id} className="text-sm bg-secondary/50 rounded-lg p-3">
                          <p className="italic text-foreground/90">"{r.text}"</p>
                          <p className="text-muted-foreground text-xs mt-2 font-medium">— {r.operatorName ?? 'System'}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
              
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
