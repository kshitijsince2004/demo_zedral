import React, { type ReactNode } from 'react';
import { ZButton } from '../primitives/ZButton';

interface Props {
  analyticName: string;
  onRetry?: () => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AnalyticErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  handleRetry = () => {
    this.setState({ hasError: false });
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-4 min-h-[100px] border border-destructive/20 bg-destructive/5 rounded-md">
          <p className="text-sm text-destructive mb-2">Could not load {this.props.analyticName}.</p>
          <ZButton variant="secondary" size="sm" onClick={this.handleRetry}>
            Retry →
          </ZButton>
        </div>
      );
    }
    return this.props.children;
  }
}
