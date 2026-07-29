import type { ReactNode } from 'react';
import { useAuthStore } from '../../../lib/authStore';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { DeskTopRail } from '../shared/DeskTopRail';
import { deskNavOffsetClass } from '../shared/deskNavLayout';
import { QualityNav } from './QualityNav';

interface QualityShellProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  controls?: ReactNode;
  children: ReactNode;
}

export function QualityShell({
  title,
  subtitle,
  onRefresh,
  refreshing,
  controls,
  children,
}: QualityShellProps) {
  const role = useAuthStore((s) => s.role);

  return (
    <div className="theme-operator min-h-screen bg-background text-foreground">
      <QualityNav />
      <div className={`flex flex-col min-w-0 min-h-screen ${deskNavOffsetClass()}`}>
        <DeskTopRail
          title={title}
          subtitle={subtitle}
          roleLabel={role ?? 'QUALITY'}
          roleTone="success"
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
