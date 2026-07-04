import type { ReactNode } from 'react';

interface ChartPanelProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function ChartPanel({ title, children, className = '' }: ChartPanelProps) {
  return (
    <div className={`border border-border rounded-2xl overflow-hidden bg-background shadow-sm ${className}`}>
      <div className="px-3 py-2 border-b border-border">
        <span className="z-rail-label">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

