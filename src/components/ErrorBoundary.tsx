import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../lib/logging';

const log = logger.child({ component: 'ErrorBoundary' });

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The one place a render crash is caught, and logging it is the point. Without
 * a boundary a thrown render leaves a blank page and nothing beyond the React
 * stack in the console, so the fallback below says what happened while the
 * record carries the error and the component stack that reached it.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    log.error('Render crashed', { error, componentStack: info.componentStack });
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8 sm:px-6">
          <p className="rounded-card border border-ash p-4 text-sm text-bone">
            Something went wrong while rendering the dashboard. The error has been logged to
            the browser console — reload the page to try again.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
