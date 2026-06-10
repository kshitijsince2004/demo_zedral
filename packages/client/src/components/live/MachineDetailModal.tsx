import React from 'react';
import type { MachineStatusCard, MachineLiveStatus } from '@m1/shared-validation';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { Activity, Power, AlertTriangle, ShieldAlert, X } from 'lucide-react';

interface MachineDetailModalProps {
  open: boolean;
  onClose: () => void;
  machineCode: string | null;
  machineData?: MachineStatusCard;
}

export function MachineDetailModal({ open, onClose, machineCode, machineData }: MachineDetailModalProps) {
  if (!open || !machineCode || !machineData) return null;

  // Render a mock comprehensive 24-hour history
  const historyEvents = [
    { id: 1, type: 'RUNNING', start: '10:15 AM', end: '11:45 AM', duration: '1h 30m', reason: 'Order B-2026-SP002' },
    { id: 2, type: 'STOPPAGE', start: '11:45 AM', end: '12:20 PM', duration: '35m', reason: 'Material Change' },
    { id: 3, type: 'RUNNING', start: '12:20 PM', end: '03:10 PM', duration: '2h 50m', reason: 'Order B-2026-R001' },
    { id: 4, type: 'DEFECT', start: '03:10 PM', end: '03:22 PM', duration: '12m', reason: 'Edge Crack Detected' },
    { id: 5, type: 'IDLE', start: '03:22 PM', end: 'Present', duration: 'Ongoing', reason: 'Waiting for Material' },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-4 right-4 z-50 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between bg-muted/20">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-info" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Machine Drill-down</h2>
            </div>
            <h1 className="text-2xl font-bold text-foreground">{machineData.machineName}</h1>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
            <X className="w-6 h-6 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 space-y-8">
          
          {/* Live State Section */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Current Status</h3>
            <div className={`rounded-xl p-6 border ${
              machineData.status === 'RUNNING' ? 'bg-[#10B981]/10 border-[#10B981]/20 text-[#10B981]' :
              machineData.status === 'IDLE' ? 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700' :
              machineData.status === 'STOPPAGE' ? 'bg-warning/10 border-warning/20 text-warning' :
              'bg-destructive/10 border-destructive/20 text-destructive'
            }`}>
              <div className="flex justify-between items-start mb-4">
                <span className="text-3xl font-bold uppercase tracking-wider">{machineData.status}</span>
                {machineData.status === 'RUNNING' && <Activity className="w-8 h-8 opacity-50" />}
                {machineData.status === 'IDLE' && <Power className="w-8 h-8 opacity-50" />}
                {machineData.status === 'STOPPAGE' && <AlertTriangle className="w-8 h-8 opacity-50 animate-pulse" />}
                {machineData.status === 'BREAKDOWN' && <ShieldAlert className="w-8 h-8 opacity-50 animate-pulse" />}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">Live Duration</span>
                  <span className="font-mono text-2xl font-bold">1h 42m 15s</span> {/* Simulated Live Timer */}
                </div>
                {machineData.status === 'RUNNING' && (
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">Current Order</span>
                    <span className="font-mono text-lg font-bold">{machineData.currentOrder || '—'}</span>
                  </div>
                )}
                {(machineData.status === 'STOPPAGE' || machineData.status === 'BREAKDOWN') && (
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">Reason</span>
                    <span className="text-lg font-bold">Material Jam</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Last 24 Hours Summary Cards */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Last 24 Hours Summary</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#10B981] block mb-1">Runtime</span>
                <div className="flex justify-between items-baseline">
                  <span className="font-mono text-xl font-bold">18h 45m</span>
                  <span className="font-bold text-sm text-[#10B981]">78%</span>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Idle Time</span>
                <div className="flex justify-between items-baseline">
                  <span className="font-mono text-xl font-bold">2h 15m</span>
                  <span className="font-bold text-sm text-slate-500">9%</span>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-widest text-warning block mb-1">Stoppages</span>
                <div className="flex justify-between items-baseline">
                  <span className="font-mono text-xl font-bold">1h 30m</span>
                  <span className="font-bold text-sm text-warning">4 Incidents</span>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-widest text-destructive block mb-1">Defects</span>
                <div className="flex justify-between items-baseline">
                  <span className="font-mono text-xl font-bold">1h 30m</span>
                  <span className="font-bold text-sm text-destructive">2 Incidents</span>
                </div>
              </div>
            </div>
          </section>

          {/* Detailed Event History */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Chronological Event History</h3>
            <div className="border border-border rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Event Type</th>
                    <th className="px-4 py-3">Start</th>
                    <th className="px-4 py-3">End</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Details / Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50 text-sm">
                  {historyEvents.map((evt) => (
                    <tr key={evt.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${
                          evt.type === 'RUNNING' ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20' :
                          evt.type === 'IDLE' ? 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400' :
                          evt.type === 'STOPPAGE' ? 'bg-warning/10 text-warning border-warning/20' :
                          'bg-destructive/10 text-destructive border-destructive/20'
                        }`}>
                          {evt.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{evt.start}</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{evt.end}</td>
                      <td className="px-4 py-3 font-mono font-bold text-foreground">{evt.duration}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{evt.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
