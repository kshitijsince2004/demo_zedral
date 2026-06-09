import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../../lib/authStore';
import { isCrmMillPath } from '../../../lib/millConfig';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { OperatorNavRail } from './OperatorNavRail';
import { StatusRail } from './StatusRail';

interface OperatorShellProps {
  processCode?: string;
  children: React.ReactNode;
}

export function OperatorShell({ processCode = 'HRS', children }: OperatorShellProps) {
  const { activeRole, logout } = useAuthStore();

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out?')) {
      logout();
    }
  };
  const location = useLocation();
  const isCrmMill = isCrmMillPath(location.pathname);

  const navOffset = isCrmMill ? 'ml-16' : 'ml-14';

  return (
    <div className="theme-operator min-h-screen bg-background text-foreground">
      <OperatorNavRail processCode={processCode} onLogout={handleLogout} />
      <div className={`flex flex-col min-w-0 min-h-screen ${navOffset}`}>
        <StatusRail processCode={processCode} onLogout={handleLogout} />
        <OfflineBanner />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
