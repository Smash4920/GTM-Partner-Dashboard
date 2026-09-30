import { useCallback, useEffect, useRef, useState } from 'react';
import { CURRENT_FISCAL_QUARTER } from './constants';
import type { DataProvider } from './DataProvider';
import { createProvider, type ProviderId } from './providers';
import { stableFailureCopy } from './queryState';

/**
 * Requested versus committed provider coordination.
 *
 * The header's selector used to swap the provider object the moment an option
 * was picked: the new label went up immediately, over data the old provider
 * had produced, and if the new source failed to answer there was no way back
 * short of picking the old one again. That is the mixed-source frame this
 * hook exists to make impossible.
 *
 * The model:
 *
 * - **Requested** is what the user asked for. It owns the selector's value
 *   and a candidate provider object, nothing else. A candidate never renders
 *   data and never relabels anything.
 * - **Committed** is authoritative: the provider object, its id, and a
 *   generation counter that increases by one per successful switch. Every
 *   view, query hook, session edit, and the error boundary key off the
 *   committed identity, so a frame either belongs to one provider generation
 *   wholesale or does not exist.
 * - Between the two sits a **readiness probe**: one bounded scoped query
 *   against the candidate. Only its success commits — object, id, and
 *   generation in a single state update, so no render can ever pair the
 *   candidate's label with the prior provider's rows. Failure leaves the
 *   committed provider untouched and offers Retry (re-probe the same
 *   candidate) and Cancel (drop the request).
 *
 * Obsolete probes are rejected twice: the AbortSignal cancels work that
 * honours cancellation, and the alive flag in the effect cleanup discards
 * late answers from candidates that ignore the signal — a probe that resolves
 * after a newer request started can never commit.
 */

/** A provider that earned the label: object, id, and generation move together. */
export interface CommittedProvider {
  id: ProviderId;
  provider: DataProvider;
  /**
   * Increases by one on every successful switch. Query results and session
   * overlays are keyed to it, so a stale answer can never cross providers.
   */
  generation: number;
}

export type ProviderTransitionStatus = 'idle' | 'probing' | 'failed';

export interface ProviderTransition {
  /** The authoritative provider. Everything rendered belongs to it. */
  committed: CommittedProvider;
  /** What the selector shows: the candidate while switching, the committed id otherwise. */
  requestedId: ProviderId;
  status: ProviderTransitionStatus;
  /**
   * Stable, operation-specific copy shown while status is 'failed' — never
   * the probe rejection's own prose (see `stableFailureCopy` in
   * `queryState.ts`). A provider error can carry internal detail, source
   * text, or user data, and none of that belongs on screen; the raw error
   * still reaches the structured log and the allowlisted telemetry
   * fingerprint at the instrumented provider seam.
   */
  failure: string | null;
  /** Ask for a different provider. Asking for the committed id cancels a pending switch. */
  requestProvider: (id: ProviderId) => void;
  /** Re-run the readiness probe against the same candidate after a failure. */
  retry: () => void;
  /** Abandon the requested switch; the committed provider simply continues. */
  cancel: () => void;
}

export interface UseCommittedProviderOptions {
  /** Provider committed at mount without a probe. Defaults to 'local'. */
  initialId?: ProviderId;
  /** Builds candidate instances. Injectable so tests control timing and tags. */
  createCandidate?: (id: ProviderId) => DataProvider;
  /** Readiness check a candidate must pass to commit. Defaults to `probeProviderReadiness`. */
  probe?: (candidate: DataProvider, signal: AbortSignal) => Promise<unknown>;
  /** Fires once per successful commit, in the same batch — session state resets ride this. */
  onCommit?: (committed: CommittedProvider) => void;
}

/**
 * The bounded readiness check: the smallest scoped query on the contract, the
 * same call the runtime health check pings the seam with. One call is the
 * right size — readiness is about whether this source answers at all, and
 * every per-widget failure path past commit already has its own retry. The
 * probe honours the caller's signal, so a cancelled or superseded switch
 * stops the candidate's work instead of waiting it out.
 */
export function probeProviderReadiness(
  candidate: DataProvider,
  signal?: AbortSignal,
): Promise<unknown> {
  return candidate.getForecastSummary({ quarter: CURRENT_FISCAL_QUARTER }, { signal });
}

interface TransitionRequest {
  id: ProviderId;
  candidate: DataProvider;
  /** Bumped by retry, so the probe effect re-runs against the same candidate. */
  attempt: number;
  failure: string | null;
}

/**
 * The one thing the transition notice may say about a failed probe. Stable
 * and operation-specific, so the alert can never render provider internals,
 * source text, or user data — the same failure-copy policy every query
 * surface follows.
 */
const READINESS_FAILURE_COPY = 'The readiness check failed';

export function useCommittedProvider(
  options: UseCommittedProviderOptions = {},
): ProviderTransition {
  const { initialId = 'local' } = options;

  // Option callbacks are read through refs so a caller that rebuilds them
  // every render cannot restart an in-flight probe.
  const createRef = useRef(options.createCandidate ?? createProvider);
  const probeRef = useRef(options.probe ?? probeProviderReadiness);
  const onCommitRef = useRef(options.onCommit);
  useEffect(() => {
    createRef.current = options.createCandidate ?? createProvider;
    probeRef.current = options.probe ?? probeProviderReadiness;
    onCommitRef.current = options.onCommit;
  });

  const [committed, setCommitted] = useState<CommittedProvider>(() => ({
    id: initialId,
    provider: createRef.current(initialId),
    generation: 0,
  }));
  const [request, setRequest] = useState<TransitionRequest | null>(null);

  // Mirrors let event handlers read the latest state without depending on it
  // (which would rebuild the callbacks — and the selector's handlers — every
  // commit).
  const committedRef = useRef(committed);
  const requestRef = useRef(request);
  useEffect(() => {
    committedRef.current = committed;
    requestRef.current = request;
  });

  // The probe is the only call a candidate answers before it earns the label.
  // A failure never touches the committed provider; a success commits object,
  // id, and generation in one update.
  useEffect(() => {
    if (request === null || request.failure !== null) return;
    const controller = new AbortController();
    let alive = true;
    let outcome: Promise<unknown>;
    try {
      outcome = Promise.resolve(probeRef.current(request.candidate, controller.signal));
    } catch (error: unknown) {
      // A probe that throws synchronously is a failed readiness check like any
      // other; routing it through the rejection path keeps one failure shape.
      outcome = Promise.reject(error);
    }
    outcome.then(
      () => {
        if (!alive || controller.signal.aborted) return;
        const next: CommittedProvider = {
          id: request.id,
          provider: request.candidate,
          generation: committedRef.current.generation + 1,
        };
        committedRef.current = next;
        setCommitted(next);
        setRequest(null);
        onCommitRef.current?.(next);
      },
      () => {
        if (!alive || controller.signal.aborted) return;
        // The rejection's own prose stays at the instrumented seam (log and
        // telemetry fingerprint); the failure state carries only the stable
        // operation-specific copy, so the notice can never render it.
        setRequest((current) =>
          current !== null && current.candidate === request.candidate
            ? { ...current, failure: stableFailureCopy(READINESS_FAILURE_COPY) }
            : current,
        );
      },
    );
    return () => {
      alive = false;
      controller.abort();
    };
  }, [request]);

  const requestProvider = useCallback((id: ProviderId) => {
    if (id === committedRef.current.id) {
      // Asking for the provider already in charge cancels a pending switch.
      setRequest(null);
      return;
    }
    const current = requestRef.current;
    if (current !== null && current.id === id && current.failure === null) return;
    setRequest({ id, candidate: createRef.current(id), attempt: 0, failure: null });
  }, []);

  const retry = useCallback(() => {
    setRequest((current) =>
      current !== null && current.failure !== null
        ? { ...current, attempt: current.attempt + 1, failure: null }
        : current,
    );
  }, []);

  const cancel = useCallback(() => {
    setRequest(null);
  }, []);

  const status: ProviderTransitionStatus =
    request === null ? 'idle' : request.failure !== null ? 'failed' : 'probing';

  return {
    committed,
    requestedId: request?.id ?? committed.id,
    status,
    failure: request?.failure ?? null,
    requestProvider,
    retry,
    cancel,
  };
}
