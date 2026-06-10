import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface PlantQualityDowntimeAreaProps {
  data: ExtendedPlantHeadDashboardData;
}

function IntelligencePanelHeader({ title }: { title: string }) {
  return (
    <div className="px-5 py-4 border-b border-border/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <h2 className="font-semibold text-foreground">{title}</h2>
      <div className="flex flex-col sm:items-end gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-muted text-muted-foreground w-fit">
          Basic Version
        </span>
        <p className="text-[11px] text-muted-foreground max-w-sm sm:text-right">
          Insights are generated based on the production data entered into the platform.
        </p>
      </div>
    </div>
  );
}

export function PlantQualityDowntimeArea({ data }: PlantQualityDowntimeAreaProps) {
  const defectTrendData = data.defectsByMachine.map((row) => ({
    ...row,
    trend: row.defects,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <IntelligencePanelHeader title="Defect Intelligence" />
        <div className="p-5 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Top Defects</h3>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.defectsByCategory} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="category" type="category" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={80} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Count" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Defect Trend</h3>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={defectTrendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="machine" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="defects" fill="hsl(var(--primary) / 0.45)" radius={[4, 4, 0, 0]} name="Defects" />
                  <Line type="monotone" dataKey="trend" stroke="hsl(var(--info))" strokeWidth={2} dot={{ r: 3 }} name="Trend" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <IntelligencePanelHeader title="Downtime Intelligence" />
        <div className="p-5 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Downtime Reasons</h3>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.downtimeByCategory} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="category" type="category" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={80} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="minutes" fill="hsl(var(--warning) / 0.55)" radius={[0, 4, 4, 0]} name="Minutes" />
                  <Line type="monotone" dataKey="minutes" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} name="Trend" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <span className="text-xs font-medium text-muted-foreground block mb-1">MTTR (Mean Time To Repair)</span>
              <span className="text-xl font-semibold text-foreground">42m</span>
            </div>
            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <span className="text-xs font-medium text-muted-foreground block mb-1">MTBF (Mean Time Between Failures)</span>
              <span className="text-xl font-semibold text-foreground">18h 30m</span>
            </div>
            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <span className="text-xs font-medium text-muted-foreground block mb-1">Worst Machine</span>
              <span className="text-sm font-semibold text-destructive">CRM 4HI (130m Downtime)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
