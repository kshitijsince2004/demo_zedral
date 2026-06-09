import type { ReactNode } from 'react';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { deskNavOffsetClass } from '../shared/DeskSideNav';
import { AdminNav } from './AdminNav';
import { AdminRail } from './AdminRail';

interface AdminShellProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  controls?: ReactNode;
  children: ReactNode;
}

export function AdminShell({
  title,
  subtitle,
  onRefresh,
  refreshing,
  controls,
  children,
}: AdminShellProps) {
  return (
    <div className="theme-operator min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className={`flex flex-col min-w-0 min-h-screen ${deskNavOffsetClass()}`}>
        <AdminRail
          title={title}
          subtitle={subtitle}
          onRefresh={onRefresh}
          refreshing={refreshing}
          controls={controls}
        />
        <OfflineBanner />
        <main className="flex-1 overflow-auto z-op-canvas p-4 md:p-5 flex flex-col gap-4">{children}</main>
      </div>
    </div>
  );
}
