import React from 'react';
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

/** jsdom has no layout engine — Recharts ResponsiveContainer needs explicit dimensions. */
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();

  function ResponsiveContainer({
    children,
    width = 800,
    height = 400,
  }: {
    children: React.ReactElement;
    width?: number | string;
    height?: number | string;
  }) {
    const resolvedWidth = typeof width === 'string' ? 800 : width;
    const resolvedHeight = typeof height === 'string' ? 400 : height;

    if (React.isValidElement(children)) {
      return React.cloneElement(children, {
        width: resolvedWidth,
        height: resolvedHeight,
      } as Record<string, unknown>);
    }

    return React.createElement(
      'div',
      {
        'data-testid': 'chart-container',
        style: { width: resolvedWidth, height: resolvedHeight },
      },
      children,
    );
  }

  return { ...actual, ResponsiveContainer };
});
