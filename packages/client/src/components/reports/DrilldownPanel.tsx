import { useEffect, useState } from 'react';
import { ZDrawer } from '../../components/primitives/ZDrawer';
import { ZButton } from '../../components/primitives/ZButton';
import { reportingService, type PlantHeadDrilldownMetric } from '../../lib/reportingService';

interface DrilldownPanelProps {
  open: boolean;
  onClose: () => void;
  metric: PlantHeadDrilldownMetric | null;
  windowDays: 1 | 7 | 30 | 90;
}

export function DrilldownPanel({ open, onClose, metric, windowDays }: DrilldownPanelProps) {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (open && metric) {
      setPage(1);
      setRecords([]);
      setTotal(0);
      load(metric, windowDays, 1, true);
    }
  }, [open, metric, windowDays]);

  const load = async (
    m: PlantHeadDrilldownMetric,
    w: 1 | 7 | 30 | 90,
    p: number,
    isReset: boolean
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await reportingService.getPlantHeadDrilldown(m, w, p);
      if (isReset) {
        setRecords(res.records);
      } else {
        setRecords((prev) => [...prev, ...res.records]);
      }
      setTotal(res.total);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to load drilldown data');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    if (!metric) return;
    const nextPage = page + 1;
    setPage(nextPage);
    load(metric, windowDays, nextPage, false);
  };

  if (!metric) return null;

  const metricLabel =
    metric === 'oee'
      ? 'OEE Components'
      : metric === 'production'
        ? 'Production Records'
        : metric === 'quality'
          ? 'Quality Records'
          : metric === 'defects'
            ? 'Defect Log'
            : 'Downtime Log';

  const title = `${metricLabel} — last ${windowDays} days`;

  return (
    <ZDrawer open={open} onClose={onClose} title={title} size="large">
      <div className="flex flex-col h-full overflow-hidden">
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm border-b border-destructive/20">
            {error}
          </div>
        )}
        
        <div className="flex-1 overflow-auto p-4">
          {records.length === 0 && !loading && !error && (
            <div className="text-center text-muted-foreground py-12 text-sm">
              No records found.
            </div>
          )}

          {records.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted">
                  <tr className="border-b border-border">
                    {Object.keys(records[0]).map((col) => (
                      <th key={col} className="px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {records.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/50 transition-colors">
                      {Object.values(r).map((val, colIdx) => (
                        <td key={colIdx} className="px-4 py-2 whitespace-nowrap">
                          {String(val ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {loading && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              Loading...
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex items-center justify-between bg-muted/20">
          <span className="text-sm text-muted-foreground">
            Showing {records.length} of {total} records
          </span>
          {records.length < total && (
            <ZButton
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Load next 500'}
            </ZButton>
          )}
        </div>
      </div>
    </ZDrawer>
  );
}
