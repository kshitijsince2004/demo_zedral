import { useMemo, useState } from 'react';
import { ZFilterPills } from '../../../components/ui/operator/ZFilterPills';
import { ZPillTabs } from '../../../components/ui/operator/ZPillTabs';
import { currentPlantDate } from '../../../lib/dateFormat';
import {
  assignIntervalLabels,
  buildLineChartData,
  buildLineTableRows,
  buildTankChartData,
  buildTankTableRows,
  lineChartSeries,
  PKL_LINE_METRIC_GROUPS,
  type PklChartRow,
  type PklLineMetricGroup,
} from '../../../lib/pklMhLiveSlice';
import {
  Panel,
  PanelBody,
  PanelHeader,
} from '../../live/MachineHeadDashboardPanels';
import { PklMhLineProcessChart, PklMhSelectedTankChart } from './PklMhLiveCharts';

type ReadingView = 'tank' | 'line';

/** Operator chart data — tank + line process readings with shared date filter. */
export function PklMhProcessReadingsSection({
  tankDate,
  onTankDateChange,
  chartRows,
  readingLabels,
  loading,
  error,
}: {
  tankDate: string;
  onTankDateChange: (d: string) => void;
  chartRows: PklChartRow[];
  readingLabels: string[];
  loading: boolean;
  error: string | null;
}) {
  const [view, setView] = useState<ReadingView>('tank');
  const [selectedTank, setSelectedTank] = useState<1 | 2 | 3>(1);
  const [lineGroup, setLineGroup] = useState<PklLineMetricGroup>('steam');

  const labeled = useMemo(
    () => assignIntervalLabels(chartRows, readingLabels),
    [chartRows, readingLabels],
  );
  const tankTableRows = useMemo(() => buildTankTableRows(labeled, selectedTank), [labeled, selectedTank]);
  const tankChartData = useMemo(() => buildTankChartData(labeled, selectedTank), [labeled, selectedTank]);
  const lineTableRows = useMemo(() => buildLineTableRows(labeled), [labeled]);
  const lineChartData = useMemo(() => buildLineChartData(labeled), [labeled]);
  const lineSeries = lineChartSeries(lineGroup);
  const lineGroupLabel = PKL_LINE_METRIC_GROUPS.find((g) => g.id === lineGroup)?.label ?? 'Line process';

  return (
    <Panel>
      <PanelHeader title="Process Readings">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
          Date
          <input
            type="date"
            value={tankDate}
            onChange={(e) => onTankDateChange(e.target.value || currentPlantDate())}
            className="rounded-lg border border-border bg-white px-2 py-1.5 text-sm font-mono tabular-nums"
          />
        </label>
      </PanelHeader>
      <PanelBody>
        <div className="p-4 space-y-4">
          <ZPillTabs
            tabs={[
              { id: 'tank', label: 'Tank readings' },
              { id: 'line', label: 'Line process' },
            ]}
            activeId={view}
            onChange={(id) => setView(id as ReadingView)}
            className="min-w-max"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          {view === 'tank' ? (
            <>
              <ZFilterPills
                options={[
                  { id: '1' as const, label: 'Tank T1' },
                  { id: '2' as const, label: 'Tank T2' },
                  { id: '3' as const, label: 'Tank T3' },
                ]}
                activeId={String(selectedTank)}
                onChange={(id) => setSelectedTank(Number(id) as 1 | 2 | 3)}
              />
              {loading ? (
                <div className="h-64 rounded-lg bg-muted animate-pulse" aria-busy />
              ) : tankChartData.length > 0 ? (
                <PklMhSelectedTankChart tankNo={selectedTank} data={tankChartData} />
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">No tank readings for {tankDate}</p>
              )}
              <ReadingsTable
                loading={loading}
                emptyLabel="No tank readings"
                headers={['Time', 'Shift', 'Interval', 'Level', 'Temp', 'Acid%', 'Iron%']}
                rows={tankTableRows.map((r) => [
                  r.chartTime, r.shiftCode, r.intervalLabel, r.level, r.temp, r.acid, r.iron,
                ])}
              />
            </>
          ) : (
            <>
              <ZFilterPills
                options={PKL_LINE_METRIC_GROUPS.map((g) => ({ id: g.id, label: g.label }))}
                activeId={lineGroup}
                onChange={(id) => setLineGroup(id as PklLineMetricGroup)}
              />
              {loading ? (
                <div className="h-64 rounded-lg bg-muted animate-pulse" aria-busy />
              ) : lineChartData.length > 0 ? (
                <PklMhLineProcessChart title={lineGroupLabel} data={lineChartData} series={lineSeries} />
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">No line process readings for {tankDate}</p>
              )}
              <ReadingsTable
                loading={loading}
                emptyLabel="No line process readings"
                headers={[
                  'Time', 'Shift', 'Interval', 'Incharge',
                  'Steam in', 'Steam out', 'Burner', 'Hot air',
                  'Dos.A', 'Dos.W', 'Dos.I',
                  'R.Cl', 'R.pH', 'R.Flow', 'R.Temp',
                ]}
                rows={lineTableRows.map((r) => [
                  r.chartTime, r.shiftCode, r.intervalLabel, r.lineIncharge,
                  r.steamInlet, r.steamOutlet, r.burnerPressure, r.hotAirTemp,
                  r.dosageAcid, r.dosageWater, r.dosageInhibitor,
                  r.rinseCl, r.rinsePh, r.rinseFlow, r.rinseTemp,
                ])}
              />
            </>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

function ReadingsTable({
  loading,
  emptyLabel,
  headers,
  rows,
}: {
  loading: boolean;
  emptyLabel: string;
  headers: string[];
  rows: string[][];
}) {
  const colSpan = headers.length;
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs font-mono tabular-nums">
        <thead>
          <tr className="text-left text-muted-foreground bg-secondary/40">
            {headers.map((h, i) => (
              <th key={h} className={i === 0 ? 'px-4 py-2' : i === headers.length - 1 ? 'px-4 py-2' : 'px-2 py-2'}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td className="px-4 py-3 text-muted-foreground" colSpan={colSpan}>Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td className="px-4 py-3 text-muted-foreground" colSpan={colSpan}>{emptyLabel}</td></tr>
          ) : (
            rows.map((cells, i) => (
              <tr key={i} className="border-t border-border">
                {cells.map((cell, j) => (
                  <td key={j} className={j === 0 ? 'px-4 py-1.5' : j === cells.length - 1 ? 'px-4 py-1.5' : 'px-2 py-1.5'}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
