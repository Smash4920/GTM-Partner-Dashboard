import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Changing this resets the boundary. Passing the active route means
   * navigating away from a broken view recovers, rather than leaving the
   * fallback pinned until a reload.
   */
  resetKey?: unknown;
import { logger } from '../lib/logging';

const log = logger.child({ component: 'ErrorBoundary' });

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a render-time throw and shows the failure instead of unmounting the
 * tree.
 *
 * Without one, any error in any view blanks the entire page, including the
 * sidebar, so the user cannot navigate to a view that still works and has no
 * indication of what happened. The views carry several implicit contracts that
 * would throw if a provider ever broke them (an empty collection where the
 * code indexes the last element, for instance), and a live provider is exactly
 * where those assumptions stop holding.
 *
 * React has no hook equivalent for this; a class is the only way.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
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

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Stands in for the error reporter a production build would send to.
    console.error('Dashboard view failed to render', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="rounded-card border border-ash p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
          View failed to render
        </p>
        <h2 className="mt-2 text-xl tracking-tight text-bone">Something went wrong here</h2>
        <p className="mt-2 max-w-2xl text-sm text-granite">
          This view could not be displayed. The rest of the dashboard still works — pick another
          page from the sidebar, which also clears this error.
        </p>
        <p className="mt-4 break-words font-mono text-[11px] text-graphite">{error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-4 rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-granite transition-colors hover:text-stone"
        >
          Try again
        </button>
      </div>
    );
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
