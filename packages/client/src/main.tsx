import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { scheduleAccessTokenRefresh } from './lib/authSession'
import { getAuthToken } from './lib/apiClient'
import SuperTokens, { SuperTokensWrapper } from 'supertokens-auth-react'
import EmailPassword from 'supertokens-auth-react/recipe/emailpassword'
import Session from 'supertokens-auth-react/recipe/session'
import { registerSW } from 'virtual:pwa-register'
import { AnalyticErrorBoundary } from './components/shared/AnalyticErrorBoundary'

const updateSW = registerSW({
  immediate: true,
  onRegistered(registration) {
    registration?.update();
  },
  onNeedRefresh() {
    updateSW(true);
  },
  onOfflineReady() {
    console.log('App is ready to work offline.');
  },
})

// Web: empty host. APK/native: VITE_API_URL host.
const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

console.info(`[Main] Initializing SuperTokens. API Host: ${host || 'localhost'}, Origin: ${window.location.origin}`);

SuperTokens.init({
    appInfo: {
        appName: 'Zedral M1',
        apiDomain: host || window.location.origin,
        websiteDomain: window.location.origin,
        apiBasePath: '/auth',
        websiteBasePath: '/login'
    },
    recipeList: [
        EmailPassword.init(),
        Session.init({ tokenTransferMethod: 'header' })
    ]
});

const existingToken = getAuthToken()
if (existingToken) {
  scheduleAccessTokenRefresh(existingToken)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalyticErrorBoundary analyticName="Application">
      <SuperTokensWrapper>
        <App />
      </SuperTokensWrapper>
    </AnalyticErrorBoundary>
  </StrictMode>,
)
