import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ApiError } from './apiClient';
import { makeIdbCacheProvider } from './swrCacheProvider';

const swrProvider = makeIdbCacheProvider();

export function AppSWRConfig({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 5_000,
        keepPreviousData: true,
        errorRetryCount: 3,
        onErrorRetry: (err, _key, _cfg, revalidate, { retryCount }) => {
          if (typeof navigator !== 'undefined' && !navigator.onLine) return;
          if (err instanceof ApiError && (err.status === 401 || err.preventRetry)) return;
          if ((err as ApiError)?.preventRetry) return;
          setTimeout(
            () => revalidate({ retryCount }),
            Math.min(30_000, 800 * 2 ** retryCount),
          );
        },
        ...(swrProvider ? { provider: swrProvider } : {}),
      }}
    >
      {children}
    </SWRConfig>
  );
}
