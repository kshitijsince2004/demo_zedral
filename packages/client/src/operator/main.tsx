import { initSuperTokens } from '../lib/supertokens';

// 1. MUST happen before any other imports that might use SuperTokens hooks
initSuperTokens();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SuperTokensWrapper } from 'supertokens-auth-react';
import '../index.css';
import { AnalyticErrorBoundary } from '../components/shared/AnalyticErrorBoundary';
import OperatorApp from './OperatorApp';
import { initNative } from './native/init';
import { AppSWRConfig } from '../lib/swrDefaults';

const root = createRoot(document.getElementById('root')!);

// 2. Paint immediately — native init (SQLCipher, sync engine, KeepAwake) runs
// in the background so login is interactive before the DB is ready. Offline
// writes gate on `offlineReadyPromise` (see native/init.ts) instead of blocking paint.
root.render(
  <StrictMode>
    <AnalyticErrorBoundary analyticName="OperatorApp">
      <SuperTokensWrapper>
        <AppSWRConfig>
          <OperatorApp />
        </AppSWRConfig>
      </SuperTokensWrapper>
    </AnalyticErrorBoundary>
  </StrictMode>,
);

void initNative().catch((err) => {
  console.error('[Operator] Native init failed', err);
});
