/**
 * SystemAdmin — infrastructure health and version info (Wave 5).
 * Replaces the legacy footer strip on operator/machine_head shells.
 */
import { useEffect, useState } from 'react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { ShiftAuditPanel } from '../../components/admin/ShiftAuditPanel';
import { ShiftWindowsPanel } from '../../components/admin/ShiftWindowsPanel';
import { ZBadge } from '../../components/primitives/ZBadge';
import { apiClient } from '../../lib/apiClient';

type ServiceStatus = 'online' | 'degraded' | 'offline' | 'checking';

interface HealthPayload {
  status?: string;
  service?: string;
  database?: string;
}

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

export function SystemAdmin() {
  const [dbStatus, setDbStatus] = useState<ServiceStatus>('checking');
  const [apiStatus, setApiStatus] = useState<ServiceStatus>('checking');
  const [serviceName, setServiceName] = useState('API');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const health = await apiClient.get<HealthPayload>('/health');
        if (cancelled) return;
        setServiceName(health.service ?? 'API');
        setApiStatus(health.status === 'ok' ? 'online' : 'degraded');
        setDbStatus(health.database === 'ok' ? 'online' : 'degraded');
      } catch {
        if (cancelled) return;
        setApiStatus('offline');
        setDbStatus('offline');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const services: Array<{ name: string; status: ServiceStatus; note?: string }> = [
    { name: serviceName, status: apiStatus },
    { name: 'Postgres', status: dbStatus },
    { name: 'SuperTokens', status: apiStatus === 'online' ? 'online' : 'checking', note: 'inferred via API reachability' },
    { name: 'Elasticsearch', status: 'checking', note: 'informational — check server logs' },
  ];

  return (
    <AdminShell title="System Health" subtitle="Integration endpoints and platform status">
      <AdminPanel title="Service status">
        <div className="divide-y divide-border">
          {services.map(({ name, status, note }) => (
            <div key={name} className="px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <span className="text-sm font-medium">{name}</span>
                {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
              </div>
              <ZBadge
                tone={status === 'online' ? 'success' : status === 'degraded' ? 'warning' : status === 'offline' ? 'destructive' : 'muted'}
                label={status}
                dot
              />
            </div>
          ))}
        </div>
      </AdminPanel>

      <ShiftWindowsPanel />
      <ShiftAuditPanel />

      <AdminPanel title="Application">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">Client version</span>
          <span className="font-mono text-xs text-foreground">{APP_VERSION}</span>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">Environment</span>
          <span className="font-mono text-xs text-foreground">{import.meta.env.MODE}</span>
        </div>
      </AdminPanel>
    </AdminShell>
  );
}
