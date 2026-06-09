import React from 'react';
import { Delete, RotateCcw } from 'lucide-react';
import { useGloveModeStore } from '../../lib/gloveModeStore';

interface ZKeypadProps {
  value: string;
  onChange: (val: string) => void;
  allowDecimal?: boolean;
  activeLabel?: string;
}

/**
 * Floor-terminal numeric keypad — docked layout, sharp keys, glove-aware sizing.
 */
export function ZKeypad({ value, onChange, allowDecimal = true, activeLabel }: ZKeypadProps) {
  const { isGloveMode } = useGloveModeStore();

  const handlePress = (key: string) => {
    if (key === 'DEL') {
      onChange(value.slice(0, -1));
    } else if (key === 'CLR') {
      onChange('');
    } else if (key === '.') {
      if (allowDecimal && !value.includes('.')) onChange(value + '.');
    } else {
      onChange(value + key);
    }
  };

  const keys: Array<{ key: string; label: React.ReactNode; span?: number }> = [
    { key: '7', label: '7' },
    { key: '8', label: '8' },
    { key: '9', label: '9' },
    { key: '4', label: '4' },
    { key: '5', label: '5' },
    { key: '6', label: '6' },
    { key: '1', label: '1' },
    { key: '2', label: '2' },
    { key: '3', label: '3' },
    ...(allowDecimal ? [{ key: '.', label: '·' }] : [{ key: '', label: '' }]),
    { key: '0', label: '0' },
    { key: 'DEL', label: <Delete className="h-4 w-4" aria-hidden /> },
    { key: 'CLR', label: <><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Clear</>, span: 3 },
  ];

  const keyHeight = isGloveMode ? 'h-14' : 'h-12';
  const gridGap = isGloveMode ? 'gap-1.5' : 'gap-1';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/40">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Entry pad
        </span>
        <span className="font-mono text-sm tabular-nums text-accent truncate max-w-[60%]">
          {activeLabel ? `${activeLabel}: ` : ''}
          {value || '—'}
        </span>
      </div>
      <div className={`grid grid-cols-3 ${gridGap} p-2 flex-1`}>
        {keys.map((k, i) => {
          if (!k.key) return <div key={i} />;
          const isAction = k.key === 'CLR' || k.key === 'DEL';
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handlePress(k.key);
              }}
              className={[
                keyHeight,
                'rounded-sm border font-mono text-base font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
                k.span === 3 ? 'col-span-3' : '',
                isAction
                  ? 'border-border bg-secondary/60 text-muted-foreground hover:bg-secondary'
                  : 'border-border bg-card text-foreground hover:border-accent/40 hover:bg-accent/5',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {k.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
