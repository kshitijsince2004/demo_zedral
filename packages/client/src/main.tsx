import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { scheduleAccessTokenRefresh } from './lib/authSession'
import { getAuthToken } from './lib/apiClient'
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

const existingToken = getAuthToken()
if (existingToken) {
  scheduleAccessTokenRefresh(existingToken)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalyticErrorBoundary analyticName="Application">
      <App />
    </AnalyticErrorBoundary>
  </StrictMode>,
)
