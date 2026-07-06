import { useEffect, useRef, useState, type ReactNode } from 'react';

interface MeasuredChartProps {
  className?: string;
  minHeight: number;
  'data-testid'?: string;
  children: (size: { width: number; height: number }) => ReactNode;
}

/** Renders chart children only after the container has real dimensions (avoids Recharts -1 size errors). */
export function MeasuredChart({ className, minHeight, children, 'data-testid': testId }: MeasuredChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{ minHeight, width: '100%' }}
      data-testid={testId}
    >
      {size ? children(size) : null}
    </div>
  );
}
