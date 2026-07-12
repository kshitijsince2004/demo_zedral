/**
 * SystemAdmin — infrastructure health and version info (Wave 5).
 * Replaces the legacy footer strip on operator/machine_head shells.
 */
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { ShiftAuditPanel } from '../../components/admin/ShiftAuditPanel';
import { ShiftWindowsPanel } from '../../components/admin/ShiftWindowsPanel';
import { ZBadge } from '../../components/primitives/ZBadge';

const SERVICES = [
  { name: 'SAP MB52', status: 'online' as const },
  { name: 'SAP MB51', status: 'online' as const },
  { name: 'Postgres', status: 'online' as const },
  { name: 'Redpanda', status: 'online' as const },
  { name: 'Readiness Worker', status: 'online' as const },
];

export function SystemAdmin() {
  return (
    <AdminShell title="System Health" subtitle="Integration endpoints and platform status">
      <AdminPanel title="Service status">
        <div className="divide-y divide-border">
          {SERVICES.map(({ name, status }) => (
            <div key={name} className="px-4 py-3 flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{name}</span>
              <ZBadge tone={status === 'online' ? 'success' : 'destructive'} label={status} dot />
            </div>
          ))}
        </div>
      </AdminPanel>

      <ShiftWindowsPanel />
      <ShiftAuditPanel />

      <AdminPanel title="Application">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">Client version</span>
          <span className="font-mono text-xs text-foreground">v1.0.0</span>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">Environment</span>
          <span className="font-mono text-xs text-foreground">M1 Pilot</span>
        </div>
      </AdminPanel>
    </AdminShell>
  );
}
