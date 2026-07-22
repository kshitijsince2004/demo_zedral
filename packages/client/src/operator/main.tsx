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

// 2. Delay native init slightly to ensure SuperTokens event listeners are settled
// and wrap in a function to control execution.
async function bootstrap() {
  try {
    await initNative();
  } catch (err) {
    console.error('[Operator] Native init failed', err);
  }

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
}

bootstrap();
