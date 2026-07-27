import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SixHiQueueCard } from '@m1/shared-validation';

const ROW_ESTIMATE_PX = 88;

interface VirtualizedQueueRowsProps {
  cards: SixHiQueueCard[];
  renderRow: (card: SixHiQueueCard) => ReactNode;
}

export function VirtualizedQueueRows({ cards, renderRow }: VirtualizedQueueRowsProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => parentRef.current?.closest('[data-queue-scroll]') as HTMLElement | null,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 6,
  });

  if (cards.length === 0) return null;

  return (
    <div ref={parentRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((item) => {
        const card = cards[item.index];
        return (
          <VirtualizedListItem
            key={card.batchNumber}
            start={item.start}
            card={card}
            renderRow={renderRow}
          />
        );
      })}
    </div>
  );
}

function VirtualizedListItem({
  start,
  card,
  renderRow,
}: {
  start: number;
  card: SixHiQueueCard;
  renderRow: (card: SixHiQueueCard) => ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${start}px)`,
      }}
    >
      {renderRow(card)}
    </div>
  );
}
