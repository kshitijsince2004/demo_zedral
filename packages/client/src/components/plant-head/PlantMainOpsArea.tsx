import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PlantMainOpsAreaProps {
  data: ExtendedPlantHeadDashboardData;
}

export function PlantMainOpsArea({ data }: PlantMainOpsAreaProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
      
      {/* Left: Production Performance (70%) */}
      <div className="lg:col-span-7 bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Production Performance</h2>
        </div>
        <div className="p-5 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Production vs Target (Daily)</h3>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.productionVsTarget}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                    itemStyle={{ fontSize: '12px' }}
                    labelStyle={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                  />
                  <Bar dataKey="targetMt" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} name="Target" />
                  <Bar dataKey="actualMt" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Actual" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Weekly Trend (MT)</h3>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.productionVsTarget}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                  />
                  <Line type="monotone" dataKey="actualMt" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Trend" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Executive Insights (30%) */}
      <div className="lg:col-span-3 bg-card border border-border rounded-xl shadow-sm flex flex-col">
        <div className="px-5 py-4 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Executive Insights</h2>
        </div>
        <div className="p-0 flex-1">
          <ul className="divide-y divide-border/50">
            <li className="px-5 py-4">
              <span className="block text-xs font-medium text-muted-foreground mb-1">Production Status</span>
              <span className="block text-sm font-semibold text-foreground">On Track (+2.4% Variance)</span>
            </li>
            <li className="px-5 py-4">
              <span className="block text-xs font-medium text-muted-foreground mb-1">Current Bottleneck</span>
              <span className="block text-sm font-semibold text-destructive">Annealing (94% Util, 45MT Queue)</span>
            </li>
            <li className="px-5 py-4">
              <span className="block text-xs font-medium text-muted-foreground mb-1">Worst Performing Machine</span>
              <span className="block text-sm font-semibold text-warning">CRM 4HI (62% Health, 2h 10m Down)</span>
            </li>
            <li className="px-5 py-4">
              <span className="block text-xs font-medium text-muted-foreground mb-1">Top Defect</span>
              <span className="block text-sm font-semibold text-foreground">Roll Mark (14.2%)</span>
            </li>
            <li className="px-5 py-4">
              <span className="block text-xs font-medium text-muted-foreground mb-1">Orders at Risk</span>
              <span className="block text-sm font-semibold text-foreground">{data.delayedOrders} Orders Delayed</span>
            </li>
          </ul>
        </div>
      </div>

    </div>
  );
}
