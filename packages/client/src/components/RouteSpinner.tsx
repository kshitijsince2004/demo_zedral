import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

/** Lightweight route fallback for desk + operator Suspense boundaries. */
export function RouteSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

export function withRouteSuspense(node: ReactNode) {
  return <Suspense fallback={<RouteSpinner />}>{node}</Suspense>;
}

/** Lazy-load a named export from a page module. */
export function lazyNamed<T extends Record<string, unknown>, K extends keyof T>(
  factory: () => Promise<T>,
  name: K,
): ComponentType<T[K] extends ComponentType<infer P> ? P : never> {
  return lazy(async () => {
    const mod = await factory();
    return { default: mod[name] as ComponentType };
  }) as ComponentType<T[K] extends ComponentType<infer P> ? P : never>;
}
