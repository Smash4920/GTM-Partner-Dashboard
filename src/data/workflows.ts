import type { ForecastCategory } from './types';

export type WorkflowTarget =
  | { kind: 'registration' | 'conflict'; entityIds: readonly string[] }
  | { kind: 'forecast'; entityIds: readonly string[]; changeId: string };

export interface WorkflowDraft {
  actorId: string;
  outcome: string;
  reason: string;
}

export type WorkflowRecord = WorkflowTarget &
  WorkflowDraft & {
    recordedAt: string;
    delivery: 'simulated/local-only';
  };

/** A current-session edit, not source history or historical ownership. */
export interface ForecastChange {
  id: string;
  opportunityId: string;
  field: 'revenue' | 'category';
  value: number | ForecastCategory;
}

export interface WorkflowActions {
  onWorkflow?: (target: WorkflowTarget) => void;
}
