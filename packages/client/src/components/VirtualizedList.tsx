import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** Fixed-row-height virtual list for long queues / tables (PERF-B2). */
export function VirtualizedList<T>({
  items,
  estimateSize,
  overscan = 8,
  className = '',
  getKey,
  renderItem,
}: {
  items: T[];
  estimateSize: number;
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  return (
    <div ref={parentRef} className={`overflow-auto ${className}`}>
      <div
        style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((row) => {
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
