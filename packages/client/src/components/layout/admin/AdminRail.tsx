import type { ReactNode } from 'react';
import { useAuthStore } from '../../../lib/authStore';
import { DeskTopRail } from '../shared/DeskTopRail';

interface AdminRailProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  controls?: ReactNode;
}

export function AdminRail({ title, subtitle, onRefresh, refreshing, controls }: AdminRailProps) {
  const { role } = useAuthStore();

  return (
    <DeskTopRail
      title={title}
      subtitle={subtitle}
      roleLabel={role ?? '—'}
      roleTone="success"
      onRefresh={onRefresh}
      refreshing={refreshing}
      controls={controls}
    />
  );
}
