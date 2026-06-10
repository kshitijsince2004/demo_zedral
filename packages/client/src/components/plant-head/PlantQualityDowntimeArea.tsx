import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PlantQualityDowntimeAreaProps {
  data: ExtendedPlantHeadDashboardData;
}

export function PlantQualityDowntimeArea({ data }: PlantQualityDowntimeAreaProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      
      {/* Left: Quality Intelligence (50%) */}
      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Defect Intelligence</h2>
        </div>
        <div className="p-5 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Top Defects</h3>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.defectsByCategory} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="category" type="category" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Count" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Defect Trend</h3>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.defectsByMachine}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="machine" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
                  <Line type="monotone" dataKey="totalDefects" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Defects" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Downtime Intelligence (50%) */}
      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Downtime Intelligence</h2>
        </div>
        <div className="p-5 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Downtime Reasons</h3>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.downtimeByCategory} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="category" type="category" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="minutes" fill="hsl(var(--warning))" radius={[0, 4, 4, 0]} name="Minutes" />
                </BarChart>
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
