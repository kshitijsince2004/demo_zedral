import React from 'react';
import { useGloveModeStore } from '../../lib/gloveModeStore';

interface NumericKeypadProps {
  value: string;
  onChange: (val: string) => void;
  allowDecimal?: boolean;
}

/**
 * Numeric keypad for shop-floor data entry.
 *
 * In normal mode keys are h-14 (56px) — meeting the ≥56px touch-target
 * requirement (Requirement 10.1). In glove mode keys grow to h-16 (64px)
 * with a wider gap for easier targeting with heavy gloves (Requirement 10.2).
 */
export function NumericKeypad({ value, onChange, allowDecimal = true }: NumericKeypadProps) {
  const { isGloveMode } = useGloveModeStore();

  const handlePress = (key: string) => {
    if (key === 'DEL') {
      onChange(value.slice(0, -1));
    } else if (key === 'CLR') {
      onChange('');
    } else if (key === '.') {
      if (allowDecimal && !value.includes('.')) {
        onChange(value + '.');
      }
    } else {
      onChange(value + key);
    }
  };

  const keys = [
    '7', '8', '9',
    '4', '5', '6',
    '1', '2', '3',
    allowDecimal ? '.' : '', '0', 'DEL',
    'CLR',
  ];

  // Glove mode: larger keys (h-16 = 64px) and wider gap; normal: h-14 (56px)
  const keyHeight = isGloveMode ? 'h-16' : 'h-14';
  const gridGap = isGloveMode ? 'gap-3' : 'gap-2';

  return (
    <div className={`grid grid-cols-3 ${gridGap} max-w-sm mx-auto`}>
      {keys.map((k, i) => {
        if (!k) return <div key={i} />;
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handlePress(k);
            }}
            className={`${keyHeight} rounded-md border border-border text-sm font-mono font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
              k === 'CLR' ? 'col-span-3 bg-secondary text-muted-foreground' :
              k === 'DEL' ? 'bg-secondary text-muted-foreground' :
              'bg-card text-foreground'
            }`}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
