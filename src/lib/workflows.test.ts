import { describe, expect, it } from 'vitest';
import type { TeamUser } from '../data/types';
import type { WorkflowTarget } from '../data/workflows';
import { recordWorkflow } from './workflows';

const actor: TeamUser = {
  id: 'actor',
  name: 'Demo actor',
  email: 'demo@example.test',
  role: 'analyst',
  status: 'active',
  channels: [],
  addedAt: '2026-01-01T00:00:00.000Z',
};
const targets: WorkflowTarget[] = [
  { kind: 'registration', entityIds: ['reg-1'] },
  { kind: 'conflict', entityIds: ['reg-2', 'reg-1'] },
  { kind: 'forecast', entityIds: ['opp-1'], changeId: 'change-1' },
];

describe('session workflows', () => {
  it.each(targets)('blocks invalid inputs for $kind without a record', (target) => {
    expect(
      recordWorkflow(
        target,
        { actorId: '', outcome: '', reason: '  ' },
        [actor],
        '2026-10-01T12:00:00.000Z',
      ),
    ).toEqual({
      ok: false,
      errors: {
        actorId: 'Select an active demo actor.',
        outcome: 'Select an outcome.',
        reason: 'Enter a reason.',
      },
    });
    for (const status of ['invited', 'suspended'] as const) {
      expect(
        recordWorkflow(
          target,
          { actorId: actor.id, outcome: 'approved', reason: 'reason' },
          [{ ...actor, status }],
          '2026-10-01T12:00:00.000Z',
        ).ok,
      ).toBe(false);
    }
  });

  it.each([
    [targets[0], 'approved'],
    [targets[0], 'rejected'],
    [targets[1], 'uphold-first'],
    [targets[1], 'share-credit'],
    [targets[1], 'escalate'],
    [targets[2], 'accepted'],
    [targets[2], 'needs-revision'],
  ] as const)(
    'records exact session fields for %j / %s and leaves inputs unchanged',
    (target, outcome) => {
      const frozen = Object.freeze({ ...target, entityIds: Object.freeze([...target.entityIds]) });
      const time = '2026-10-01T12:34:56.789Z';
      expect(
        recordWorkflow(
          frozen,
          { actorId: actor.id, outcome, reason: '  reviewed locally  ' },
          [Object.freeze(actor)],
          time,
        ),
      ).toEqual({
        ok: true,
        record: {
          ...target,
          entityIds: [...target.entityIds].sort(),
          outcome,
          actorId: 'actor',
          reason: 'reviewed locally',
          recordedAt: time,
          delivery: 'simulated/local-only',
        },
      });
    },
  );

  it('rejects wrong-kind outcomes, malformed entities, and invalid action time', () => {
    for (const target of targets) {
      expect(
        recordWorkflow(
          target,
          { actorId: 'actor', outcome: 'unknown', reason: 'reason' },
          [actor],
          '2026-10-01T12:00:00.000Z',
        ).ok,
      ).toBe(false);
    }
    for (const target of [
      { kind: 'registration', entityIds: [] },
      { kind: 'registration', entityIds: [' '] },
      { kind: 'conflict', entityIds: ['reg-1', 'reg-1'] },
      { kind: 'forecast', entityIds: ['opp-1'], changeId: '' },
    ] as WorkflowTarget[]) {
      expect(
        recordWorkflow(
          target,
          { actorId: 'actor', outcome: 'approved', reason: 'reason' },
          [actor],
          '2026-10-01T12:00:00.000Z',
        ).ok,
      ).toBe(false);
    }
    expect(
      recordWorkflow(
        targets[0],
        { actorId: 'actor', outcome: 'approved', reason: 'reason' },
        [actor],
        'invalid',
      ).ok,
    ).toBe(false);
  });

  it('separates provider as-of time from action time', () => {
    const draft = { actorId: 'actor', outcome: 'approved', reason: 'reason' };
    const first = recordWorkflow(targets[0], draft, [actor], '2026-10-01T00:00:00.000Z');
    const second = recordWorkflow(targets[0], draft, [actor], '2026-11-01T00:00:00.000Z');
    expect(first).toMatchObject({ record: { recordedAt: '2026-10-01T00:00:00.000Z' } });
    expect(second).toMatchObject({ record: { recordedAt: '2026-11-01T00:00:00.000Z' } });
  });
});
