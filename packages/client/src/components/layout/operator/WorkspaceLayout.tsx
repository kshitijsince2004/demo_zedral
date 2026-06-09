import React from 'react';

interface WorkspaceLayoutProps {
  /** Optional left queue / context column */
  left?: React.ReactNode;
  /** Main capture area */
  center: React.ReactNode;
  /** Live summary column */
  right?: React.ReactNode;
  /** Docked keypad + actions */
  dock?: React.ReactNode;
}

/**
 * Three-column production workspace with bottom-docked entry pad.
 * Height fills the operator viewport below the status rail.
 */
export function WorkspaceLayout({ left, center, right, dock }: WorkspaceLayoutProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {left && (
          <aside className="w-[220px] shrink-0 border-r border-border overflow-y-auto hidden xl:block">
            {left}
          </aside>
        )}
        <section className="flex-1 min-w-0 overflow-y-auto border-r border-border">
          {center}
        </section>
        {right && (
          <aside className="w-[240px] shrink-0 overflow-y-auto hidden lg:block bg-card/50">
            {right}
          </aside>
        )}
      </div>
      {dock && (
        <div className="shrink-0 border-t border-border bg-card h-[220px] lg:h-[200px]">
          {dock}
        </div>
      )}
    </div>
  );
}
