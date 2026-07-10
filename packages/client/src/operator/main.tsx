import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AnalyticErrorBoundary } from '../components/shared/AnalyticErrorBoundary';
import OperatorApp from './OperatorApp';
import { initNative } from './native/init';

const root = createRoot(document.getElementById('root')!);

initNative()
  .catch((err) => console.error('[Operator] Native init failed — continuing without offline DB', err))
  .finally(() => {
    root.render(
      <StrictMode>
        <AnalyticErrorBoundary analyticName="OperatorApp">
          <OperatorApp />
        </AnalyticErrorBoundary>
      </StrictMode>,
    );
  });
