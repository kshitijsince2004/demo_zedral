import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { ZBadge } from '../../primitives/ZBadge';
import { ZButton } from '../../primitives/ZButton';
import type { Tone } from '../../../lib/tones';

interface DeskTopRailProps {
  title: string;
  subtitle?: string;
  roleLabel?: string | null;
  roleTone?: Tone;
  onRefresh?: () => void;
  refreshing?: boolean;
  controls?: ReactNode;
  trailing?: ReactNode;
}

export function DeskTopRail({
  title,
  subtitle,
  roleLabel,
  roleTone = 'muted',
  onRefresh,
  refreshing,
  controls,
  trailing,
}: DeskTopRailProps) {
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }) + ' IST',
      );
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="shrink-0 border-b border-border bg-background sticky top-0 z-30 shadow-sm">
      <div className="flex items-center min-h-[52px] px-4 md:px-5 gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>

        {controls && <div className="flex items-center gap-2">{controls}</div>}

        <div className="flex-1 min-w-[1rem]" />

        {trailing}

        {roleLabel && <ZBadge tone={roleTone} label={roleLabel} />}

        <span className="font-mono text-xs text-muted-foreground tabular-nums hidden md:block">{clock}</span>

        {onRefresh && (
          <ZButton variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </ZButton>
        )}
      </div>
    </header>
  );
}
