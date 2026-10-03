import type { ProviderTransitionStatus } from '../data/useCommittedProvider';

interface ProviderTransitionNoticeProps {
  status: ProviderTransitionStatus;
  /**
   * Stable, operation-specific copy for a failed readiness probe, when
   * status is 'failed' — never the rejection's own prose, so this notice
   * can never render provider internals, source text, or user data.
   */
  failure: string | null;
  /** The candidate the user asked for. */
  requestedLabel: string;
  /** The provider whose data is actually on screen. */
  committedLabel: string;
  onRetry: () => void;
  onCancel: () => void;
}

/**
 * The requested-versus-committed story, told out loud.
 *
 * A provider the user selected is only a *candidate* until its readiness
 * probe passes, so while the probe runs — and especially after it fails —
 * this notice is what keeps the screen honest about which provider the data
 * belongs to. It renders nothing when no switch is in flight.
 */
export default function ProviderTransitionNotice({
  status,
  failure,
  requestedLabel,
  committedLabel,
  onRetry,
  onCancel,
}: ProviderTransitionNoticeProps) {
  if (status === 'probing') {
    return (
      <p
        role="status"
        className="mb-6 flex items-center gap-2 rounded-card border border-ash p-4 text-xs text-granite"
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-signal" />
        Switching to {requestedLabel} — checking that it answers. {committedLabel} data stays on
        screen until the switch completes.
      </p>
    );
  }

  if (status === 'failed') {
    return (
      <div role="alert" className="mb-6 rounded-card border border-ash p-4">
        <p className="text-sm text-bone">
          <span className="text-signal">Couldn’t switch to {requestedLabel}:</span> {failure}
        </p>
        <p className="mt-1 text-xs text-granite">
          Still using {committedLabel} — the data on screen is unchanged.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20"
          >
            Retry switch to {requestedLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-granite transition-colors hover:bg-ash/20 hover:text-stone"
          >
            Stay on {committedLabel}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
