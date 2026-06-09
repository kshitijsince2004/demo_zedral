interface ZPillTabsProps {
  tabs: { id: string; label: string }[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

/** Pill tab bar — operator design system (SixHi reference). */
export function ZPillTabs({ tabs, activeId, onChange, className = '' }: ZPillTabsProps) {
  return (
    <div className={['inline-flex items-center gap-1 p-1.5 bg-background border border-border rounded-full shadow-sm', className].join(' ')}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={[
              'px-5 py-2.5 text-sm font-medium rounded-full transition-all min-h-[44px]',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
