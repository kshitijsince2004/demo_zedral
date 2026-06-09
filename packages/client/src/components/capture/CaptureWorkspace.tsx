import React from 'react';
import { ZPillTabs } from '../ui/operator/ZPillTabs';

export interface CaptureTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface CaptureWorkspaceProps {
  tabs: CaptureTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  summary: React.ReactNode;
  keypad: React.ReactNode;
  footer?: React.ReactNode;
  statusBar?: React.ReactNode;
  leftPanel?: React.ReactNode;
}

export function CaptureWorkspace({
  tabs,
  activeTab,
  onTabChange,
  summary,
  keypad,
  footer,
  statusBar,
  leftPanel,
}: CaptureWorkspaceProps) {
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {statusBar}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {leftPanel && (
          <aside className="w-[200px] shrink-0 border-r border-border overflow-y-auto hidden xl:block">
            {leftPanel}
          </aside>
        )}

        <section className="flex-1 min-w-0 flex flex-col min-h-0 bg-background">
          <div className="shrink-0 px-4 py-3 border-b border-border bg-secondary/50">
            <ZPillTabs
              tabs={tabs.map((t) => ({ id: t.id, label: t.label }))}
              activeId={activeTab}
              onChange={onTabChange}
            />
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">{active?.content}</div>
            <aside className="w-[220px] shrink-0 border-l border-border overflow-y-auto hidden md:block">
              {summary}
            </aside>
          </div>
        </section>
      </div>

      <div className="shrink-0 border-t border-border flex min-h-[200px] max-h-[240px]">
        <div className="flex-1 min-w-0">{keypad}</div>
        {footer && (
          <div className="w-[200px] shrink-0 border-l border-border p-3 flex flex-col justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
