import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AnalyticErrorBoundary } from '../components/shared/AnalyticErrorBoundary';
import OperatorApp from './OperatorApp';
import { initNative } from './native/init';

initNative().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AnalyticErrorBoundary analyticName="OperatorApp">
        <OperatorApp />
      </AnalyticErrorBoundary>
    </StrictMode>,
  );
});
