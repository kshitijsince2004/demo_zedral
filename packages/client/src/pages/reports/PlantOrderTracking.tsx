import { useState, useEffect, useRef } from 'react';
import { Search, History, Package, Cpu } from 'lucide-react';
import { traceabilityService, type TraceabilitySearchResult, type SuggestionResult } from '../../lib/traceabilityService';
import { formatTraceabilityRecordDetails } from '../../lib/traceabilityFormat';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { OrderIdentityDisplay } from '../../components/orders/OrderIdentityDisplay';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { formatPlantDate } from '../../lib/dateFormat';

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export function PlantOrderTracking({ standalone = false }: { standalone?: boolean }) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceabilitySearchResult | null>(null);

  const [suggestions, setSuggestions] = useState<SuggestionResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debouncedQuery.length >= 2 && !result && document.activeElement?.tagName === 'INPUT') {
      traceabilityService.suggest(debouncedQuery)
        .then((data) => {
          setSuggestions(data);
          setShowSuggestions(true);
        })
        .catch(() => {
          setSuggestions([]);
        });
    } else {
      setShowSuggestions(false);
    }
  }, [debouncedQuery, result]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const executeSearch = async (q: string) => {
    if (!q) return;
    setQuery(q);
    setShowSuggestions(false);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await traceabilityService.search(q);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    executeSearch(query.trim());
  };

  const content = (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
      {!standalone && (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Traceability</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Search by order, batch, coil, production number, customer reference, or material number
          </p>
        </div>
      )}

      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1" ref={wrapperRef}>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" aria-hidden />
          <ZInput
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setResult(null); // Clear previous result on typing
            }}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            placeholder="Batch, coil, SAP order, slit ID…"
            className="pl-12 min-h-12 w-full"
            autoComplete="off"
          />

          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in">
              <div className="px-3 py-2 bg-muted/40 border-b border-border/50">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Suggestions</span>
              </div>
              <ul className="max-h-64 overflow-auto py-1">
                {suggestions.map((s, idx) => (
                  <li key={`${s.text}-${idx}`}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-muted/50 flex items-center gap-3 transition-colors group"
                      onClick={() => executeSearch(s.text)}
                    >
                      <div className="w-6 h-6 rounded bg-background border border-border flex items-center justify-center shrink-0 group-hover:border-primary/30 transition-colors">
                        {s.type === 'batch' ? (
                          <Package className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        ) : s.type === 'sap_order' ? (
                          <History className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        ) : (
                          <Cpu className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-foreground">{s.text}</span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.type.replace('_', ' ')}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <ZButton type="submit" variant="accent" disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </ZButton>
      </form>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {result.orderInfo && (
            <section className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border/50">
                <h3 className="font-semibold text-foreground">Order Information</h3>
              </div>
              <div className="px-5 pt-5">
                <OrderIdentityDisplay
                  order={{
                    batchNumber: result.orderInfo.batchNumber,
                    motherCoil: result.orderInfo.motherCoil ?? result.orderInfo.coilNo,
                    coilNo: result.orderInfo.coilNo,
                    slitId: result.orderInfo.slitId ?? undefined,
                  }}
                  size="lg"
                />
              </div>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5 text-sm">
                {[
                  ['Customer', result.orderInfo.customer],
                  ['Grade', result.orderInfo.grade],
                  ['Status', result.orderInfo.status],
                  ['Process', result.orderInfo.subProcess],
                  ['Machine', result.orderInfo.machineAllocated ? result.orderInfo.machineCode : 'Unassigned'],
                  ['Weight', `${result.orderInfo.weightMt} MT`],
                  ['Plan Date', formatPlantDate(result.orderInfo.planDate)],
                  ['Shift', result.orderInfo.shiftCode],
                  ...(result.orderInfo.sapOrderNo ? [['SAP Order', result.orderInfo.sapOrderNo] as const] : []),
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
                    <dd className="font-semibold mt-1 font-mono text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {result.machineJourney.length > 0 && (
            <section className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border/50">
                <h3 className="font-semibold text-foreground">Machine Journey</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Step</th>
                      <th className="px-4 py-3">Process</th>
                      <th className="px-4 py-3">Machine</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {result.machineJourney.map((step) => (
                      <tr key={step.step}>
                        <td className="px-4 py-3 font-mono">{step.step}</td>
                        <td className="px-4 py-3">{step.process}</td>
                        <td className="px-4 py-3 font-mono">{step.machine ?? '—'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge tone="info" label={step.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Production History</h3>
              <span className="text-xs text-muted-foreground font-mono">Coil lineage: {result.lineage.join(' → ')}</span>
            </div>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 sticky top-0 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Process</th>
                    <th className="px-4 py-3">Coil</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {result.history.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                        No production history found for this identifier.
                      </td>
                    </tr>
                  )}
                  {result.history.map((entry, idx) => {
                    const details = formatTraceabilityRecordDetails(entry.process, entry.record, {
                      stoppages: entry.stoppages,
                      siblings: entry.siblings,
                    });
                    return (
                    <tr key={`${entry.process}-${entry.coilNo}-${idx}`}>
                      <td className="px-4 py-3">
                        <StatusBadge tone="muted" label={entry.process} />
                      </td>
                      <td className="px-4 py-3 font-mono">{entry.coilNo}</td>
                      <td className="px-4 py-3 text-xs">
                        {details.length > 0 ? (
                          <dl className="flex flex-wrap gap-x-4 gap-y-1">
                            {details.map(({ label, value }) => (
                              <div key={label} className="flex gap-1.5">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd className="font-medium text-foreground">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );

  if (standalone) {
    return (
      <MachineHeadShell title="Order Tracing" subtitle="Search by order, batch, coil, or customer reference">
        {content}
      </MachineHeadShell>
    );
  }

  return content;
}
