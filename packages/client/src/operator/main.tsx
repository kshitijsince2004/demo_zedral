import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SuperTokens, { SuperTokensWrapper } from 'supertokens-auth-react';
import EmailPassword from 'supertokens-auth-react/recipe/emailpassword';
import Session from 'supertokens-auth-react/recipe/session';
import '../index.css';
import { AnalyticErrorBoundary } from '../components/shared/AnalyticErrorBoundary';
import OperatorApp from './OperatorApp';
import { initNative } from './native/init';

// Web: empty host. APK/native: VITE_API_URL host.
const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

console.info(`[Operator Main] Initializing SuperTokens. API Host: ${host || 'localhost'}, Origin: ${window.location.origin}`);

SuperTokens.init({
  appInfo: {
    appName: 'Zedral M1',
    apiDomain: host || window.location.origin,
    websiteDomain: window.location.origin,
    apiBasePath: '/auth',
    websiteBasePath: '/login',
  },
  recipeList: [
    EmailPassword.init(),
    Session.init({ tokenTransferMethod: 'header' }),
  ],
});

const root = createRoot(document.getElementById('root')!);

initNative()
  .catch((err) => console.error('[Operator] Native init failed — continuing without offline DB', err))
  .finally(() => {
    root.render(
      <StrictMode>
        <AnalyticErrorBoundary analyticName="OperatorApp">
          <SuperTokensWrapper>
            <OperatorApp />
          </SuperTokensWrapper>
        </AnalyticErrorBoundary>
      </StrictMode>,
    );
  });
