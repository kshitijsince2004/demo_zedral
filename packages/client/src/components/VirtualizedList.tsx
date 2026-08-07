import { useEffect, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** Fixed-row-height virtual list for long queues / tables (PERF-B2 + C2 near-end). */
export function VirtualizedList<T>({
  items,
  estimateSize,
  overscan = 8,
  className = '',
  getKey,
  renderItem,
  onNearEnd,
  nearEndOffset = 4,
}: {
  items: T[];
  estimateSize: number;
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  /** PERF-C2: fire when the last visible virtual row is within nearEndOffset of the end. */
  onNearEnd?: () => void;
  nearEndOffset?: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIdx = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]!.index : -1;

  useEffect(() => {
    if (!onNearEnd || items.length === 0 || lastIdx < 0) return;
    if (lastIdx >= items.length - nearEndOffset) onNearEnd();
  }, [lastIdx, items.length, nearEndOffset, onNearEnd]);

  return (
    <div ref={parentRef} className={`overflow-auto ${className}`}>
      <div
        style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}
      >
        {virtualItems.map((row) => {
          const item = items[row.index];
          return (
            <div
              key={getKey(item, row.index)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
            >
              {renderItem(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
