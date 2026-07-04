import { Breadcrumbs } from './Breadcrumbs';

interface UnifiedHeaderProps {
  title: string;
  subtitle?: string;
}

export function UnifiedHeader({ title, subtitle }: UnifiedHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-card px-4 py-4 md:px-5">
      <div className="flex flex-col gap-2">
        <Breadcrumbs />
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-nav">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
    </header>
  );
}
