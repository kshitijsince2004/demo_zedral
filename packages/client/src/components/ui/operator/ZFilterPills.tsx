interface ZFilterPillsProps<T extends string> {
  options: { id: T; label: string; count?: number }[];
  activeId: T;
  onChange: (id: T) => void;
}

export function ZFilterPills<T extends string>({ options, activeId, onChange }: ZFilterPillsProps<T>) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={[
            'min-h-12 px-4 rounded-full text-xs font-bold border transition-colors',
            activeId === opt.id
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:text-foreground',
          ].join(' ')}
        >
          {opt.label}
          {opt.count !== undefined ? ` (${opt.count})` : ''}
        </button>
      ))}
    </div>
  );
}
