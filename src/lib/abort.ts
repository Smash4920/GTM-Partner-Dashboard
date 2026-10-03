/**
 * Cancellation primitives shared across the data seam.
 *
 * The hooks own the AbortControllers; these helpers are what make an abort
 * *provider-visible* rather than only a write-suppression hint. A provider
 * that honours its signal rejects with an abort error the moment the work is
 * obsolete — during a simulated network wait, before delegating to an inner
 * provider, or at entry when the signal was already spent — and the layers in
 * between (tracing, telemetry, the hooks themselves) recognise that error and
 * treat it as a cancellation, never as a failure worth logging or capturing.
 *
 * The error is a plain `Error` named `AbortError` rather than a DOMException
 * so it behaves identically in the browser, jsdom, and Node test runners.
 */

/** The rejection an aborted operation produces. One shape, everywhere. */
export function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/** True for a cancellation rejection, however far it travelled. */
export function isAbortError(error: unknown): boolean {
  // Structural, not instanceof: a provider may reject with its signal's
  // DOMException reason, whose Error ancestry varies by runtime.
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** Entry guard: a call made with an already-spent signal does no work at all. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw createAbortError();
}

/**
 * A wait that ends early when the caller walks away. The rejection is the
 * shared abort error, the timer is always cleared, and the listener is always
 * removed, so a cancelled wait leaves nothing behind.
 */
export function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(createAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
