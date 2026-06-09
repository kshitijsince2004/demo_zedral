import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { liveService } from '../../lib/liveService';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { Shell } from '../../components/layout/Shell';
import type { MachineHeadDashboardData, MachineStatusCard } from '@m1/shared-validation';
import { userScopePath } from '../../lib/userScope';

export function MachineHeadDashboard() {
  const [machines, setMachines] = useState<MachineStatusCard[]>([]);
  const [data, setData] = useState<MachineHeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  
  const navigate = useNavigate();
  const setActiveMachine = useAuthStore((s) => s.setActiveMachine);
  const username = useAuthStore((s) => s.username);
  const role = useAuthStore((s) => s.role);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [machinesRes, dashboardRes] = await Promise.all([
          liveService.getMachines(),
          liveService.getMachineHeadDashboard()
        ]);
        if (active) {
          setMachines(machinesRes.machines);
          setData(dashboardRes);
        }
      } catch (err) {
        console.error('Failed to load dashboard', err);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const handleSelectMachine = (code: string) => {
    setActiveMachine(code);
    if (username && role) {
      navigate(userScopePath(username, role));
    } else {
      navigate(`/shift-log/${code}`);
    }
  };

  return (
    <Shell title="Machine Head Dashboard" eyebrow="Live Overview">
      <div className="space-y-8 pb-10">
        {/* Top: Machine Cards */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tracking-tight">Machine Status</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live Updates
            </div>
          </div>
          {loading && machines.length === 0 ? (
            <div className="h-48 rounded-2xl bg-secondary animate-pulse" />
          ) : (
            <MachineStatusBoard machines={machines} onSelect={handleSelectMachine} />
          )}
        </section>

        {/* Shift Summary & KPI Row */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card rounded-2xl border border-border p-5 flex flex-col justify-center shadow-sm">
              <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Shift Production</span>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold font-mono text-foreground">{data.shiftSummary.actualMt}</span>
                <span className="text-sm text-muted-foreground mb-1">/ {data.shiftSummary.targetMt} MT</span>
              </div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-5 flex flex-col justify-center shadow-sm">
              <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Active Orders</span>
              <span className="text-3xl font-bold font-mono text-foreground">{data.shiftSummary.orderCount}</span>
            </div>
            {data.utilization.map(u => (
              <div key={u.machineCode} className="bg-card rounded-2xl border border-border p-5 flex flex-col justify-center shadow-sm">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">{u.machineName} Util.</span>
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold font-mono text-foreground">{u.utilizationPct}%</span>
                  <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${u.utilizationPct}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Main content grid */}
        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Col */}
            <div className="space-y-6">
              <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-border bg-muted/30">
                  <h3 className="font-semibold text-foreground">Recent Production</h3>
                </div>
                <div className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/10 text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Batch</th>
                        <th className="px-4 py-3 text-left font-medium">Machine</th>
                        <th className="px-4 py-3 text-right font-medium">Weight (MT)</th>
                        <th className="px-4 py-3 text-right font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.productionHistory.length === 0 && (
                        <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No recent production</td></tr>
                      )}
                      {data.productionHistory.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/10">
                          <td className="px-4 py-3 font-mono text-foreground">{row.batchNumber}</td>
                          <td className="px-4 py-3">{row.machineCode}</td>
                          <td className="px-4 py-3 text-right text-emerald-600 font-semibold">{row.weightMt}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                            {new Date(row.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right Col */}
            <div className="space-y-6">
              <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-border bg-muted/30">
                  <h3 className="font-semibold text-foreground">Active Stoppages</h3>
                </div>
                <div className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/10 text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Machine</th>
                        <th className="px-4 py-3 text-left font-medium">Category</th>
                        <th className="px-4 py-3 text-right font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.stoppages.length === 0 && (
                        <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No active stoppages</td></tr>
                      )}
                      {data.stoppages.map((row, i) => (
                        <tr key={i} className="hover:bg-amber-500/5">
                          <td className="px-4 py-3 font-semibold">{row.machineCode}</td>
                          <td className="px-4 py-3 text-amber-700">{row.category}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700">
                            {row.durationMin ? `${row.durationMin}m` : 'Just now'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
