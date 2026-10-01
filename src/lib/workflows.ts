import type { TeamUser } from '../data/types';
import type { WorkflowDraft, WorkflowRecord, WorkflowTarget } from '../data/workflows';

export const WORKFLOW_OUTCOMES = {
  registration: ['approved', 'rejected'],
  conflict: ['uphold-first', 'share-credit', 'escalate'],
  forecast: ['accepted', 'needs-revision'],
} as const;

/** Pure validation and projection. Only the caller supplies runtime action time. */
export function recordWorkflow(
  target: WorkflowTarget,
  draft: WorkflowDraft,
  roster: readonly TeamUser[],
  recordedAt: string,
):
  | { ok: true; record: WorkflowRecord }
  | {
      ok: false;
      errors: Partial<Record<keyof WorkflowDraft | 'target', string>>;
    } {
  const errors: Partial<Record<keyof WorkflowDraft | 'target', string>> = {};
  if (!roster.some((user) => user.id === draft.actorId && user.status === 'active')) {
    errors.actorId = 'Select an active demo actor.';
  }
  if (!(WORKFLOW_OUTCOMES[target.kind] as readonly string[]).includes(draft.outcome)) {
    errors.outcome = 'Select an outcome.';
  }
  if (!draft.reason.trim()) errors.reason = 'Enter a reason.';
  const ids = [...new Set(target.entityIds)].sort();
  if (
    ids.some((id) => !id.trim() || id !== id.trim()) ||
    (target.kind === 'conflict' ? ids.length < 2 : ids.length !== 1) ||
    (target.kind === 'forecast' && !target.changeId.trim()) ||
    !Number.isFinite(Date.parse(recordedAt)) ||
    new Date(recordedAt).toISOString() !== recordedAt
  ) {
    errors.target = 'Workflow entity or runtime timestamp is unavailable.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    record: {
      ...target,
      entityIds: ids,
      ...draft,
      reason: draft.reason.trim(),
      recordedAt,
      delivery: 'simulated/local-only',
    },
  };
}
