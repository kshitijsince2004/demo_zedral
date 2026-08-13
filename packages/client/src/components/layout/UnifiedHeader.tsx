import { Breadcrumbs } from './Breadcrumbs';
import { SyncStatusBadge } from '../../lib/sync/SyncStatusBadge';
import { overlayClass } from '../../lib/nativeOverlay';

interface UnifiedHeaderProps {
  title: string;
  subtitle?: string;
}

export function UnifiedHeader({ title, subtitle }: UnifiedHeaderProps) {
  return (
    <header className={overlayClass('z-tint sticky top-0 z-20 shrink-0 border-b border-border px-4 py-4 md:px-5', 'backdrop-blur-sm')}>
      <div className="flex flex-col gap-2">
        <Breadcrumbs />
        <div className="flex items-stretch gap-3">
          <span className="w-1 rounded-full bg-accent shrink-0" aria-hidden />
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight text-nav">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <SyncStatusBadge />
        </div>
      </div>
    </header>
  );
}
