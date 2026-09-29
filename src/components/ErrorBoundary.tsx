import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../lib/logging';
import { telemetry } from '../lib/telemetry/telemetry';

const log = logger.child({ component: 'ErrorBoundary' });

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Changing this resets the boundary. Passing the active route means
   * navigating away from a broken view recovers, rather than leaving the
   * fallback pinned until a reload.
   *
   * Left unset for the app-level boundary in `main.tsx`, which has nothing to
   * reset against and renders the whole page; when set, the fallback is an
   * inline card so the working shell — sidebar included — stays usable around
   * it.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The one place a render crash is caught, and logging it is the point. Without
 * a boundary a thrown render leaves a blank page and nothing beyond the React
 * stack in the console, so the fallback says what happened while the record
 * carries the error and the component stack that reached it.
 *
 * It is used at two levels and the difference matters. In `main.tsx` it wraps
 * the whole app, so nothing outside it can recover and the fallback takes the
 * page. Inside `App` it wraps the route switch and takes a `resetKey`, so a
 * single view failing leaves the sidebar working — the user can navigate to a
 * view that still renders, which also clears the error.
 *
 * The views carry implicit contracts that would throw if a provider ever broke
 * them (an empty collection where the code indexes the last element, for
 * instance), and a live provider is exactly where those assumptions stop
 * holding.
 *
 * React has no hook equivalent for this; a class is the only way.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    log.error('Render crashed', { error, componentStack: info.componentStack });
    // Render crashes are the most expensive errors this app can produce — a
    // whole view or the whole page is gone — so they are captured as critical.
    // The component stack stays in the local log record above: the envelope
    // carries only the technical classification (class, fingerprint, category,
    // severity, route, provider), never raw error or React prose.
    telemetry.captureError(error, {
      severity: 'critical',
      category: 'render',
    });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const card = (
      <div role="alert" className="rounded-card border border-ash p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
          View failed to render
        </p>
        <h2 className="mt-2 text-xl tracking-tight text-bone">Something went wrong here</h2>
        <p className="mt-2 max-w-2xl text-sm text-granite">
          This view could not be displayed. The error has been logged to the browser console. The
          rest of the dashboard still works — pick another page from the sidebar, which also clears
          this error.
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

    // No `resetKey` means the app-level boundary: there is no shell to keep,
    // so the message takes the page.
    if (this.props.resetKey === undefined) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8 sm:px-6">
          {card}
        </div>
      );
    }
    return card;
  }
}
