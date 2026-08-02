import React, { type ReactNode } from 'react';
import { ZButton } from '../primitives/ZButton';

interface Props {
  analyticName: string;
  /** When this changes while errored, clear the sticky boundary (route recovery). */
  resetKey?: string;
  onRetry?: () => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

/** Catches render crashes. HMR does not clear class-boundary state — reset on resetKey or Reload. */
export class AnalyticErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? 'Unknown error' };
  }

  componentDidUpdate(prevProps: Props) {
    if (
      this.state.hasError
      && this.props.resetKey != null
      && this.props.resetKey !== prevProps.resetKey
    ) {
      this.setState({ hasError: false, message: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: null });
    this.props.onRetry?.();
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 min-h-[160px] border border-destructive/20 bg-destructive/5 rounded-md gap-3">
          <p className="text-sm text-destructive font-medium">Could not load {this.props.analyticName}.</p>
          {this.state.message && (
            <p className="text-xs text-muted-foreground font-mono max-w-lg text-center">{this.state.message}</p>
          )}
          <div className="flex gap-2">
            <ZButton variant="secondary" size="sm" onClick={this.handleRetry}>
              Retry →
            </ZButton>
            <ZButton size="sm" onClick={this.handleReload}>
              Reload page
            </ZButton>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
