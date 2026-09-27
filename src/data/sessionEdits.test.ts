import { describe, expect, it } from 'vitest';
import { applySessionEdits, NO_SESSION_EDITS, type SessionEdits } from './sessionEdits';
import { makeOpportunity } from '../test/fixtures';

const edits = (overrides: Partial<SessionEdits> = {}): SessionEdits => ({
  ...NO_SESSION_EDITS,
  ...overrides,
});

describe('applySessionEdits', () => {
  it('returns untouched opportunities by reference', () => {
    const opportunity = makeOpportunity();
    const [result] = applySessionEdits([opportunity], NO_SESSION_EDITS);
    // Identity matters: downstream memoisation uses it to tell what changed.
    expect(result).toBe(opportunity);
  });

  it('leaves the provider book unmutated', () => {
    const opportunity = makeOpportunity({ forecastedRevenue: 250_000 });
    applySessionEdits([opportunity], edits({ revenueOverrides: { 'opp-1': 900_000 } }));
    expect(opportunity.forecastedRevenue).toBe(250_000);
  });

  it('overrides the provider revenue figure', () => {
    const [result] = applySessionEdits(
      [makeOpportunity()],
      edits({ revenueOverrides: { 'opp-1': 400_000 } }),
    );
    expect(result.forecastedRevenue).toBe(400_000);
  });

  it('keeps a zero revenue override rather than treating it as absent', () => {
    const [result] = applySessionEdits(
      [makeOpportunity()],
      edits({ revenueOverrides: { 'opp-1': 0 } }),
    );
    expect(result.forecastedRevenue).toBe(0);
  });

  it('applies a re-called forecast category', () => {
    const [result] = applySessionEdits(
      [makeOpportunity({ forecastCategory: 'pipeline' })],
      edits({ forecastCalls: { 'opp-1': 'commit' } }),
    );
    expect(result.forecastCategory).toBe('commit');
  });

  // Regression: the edit maps used to delete a key when the value was
  // emptied, so `?? provider value` restored what the manager had just
  // cleared and the edit appeared to fail.
  it('keeps a cleared next step cleared', () => {
    const [result] = applySessionEdits(
      [makeOpportunity({ nextStep: 'Send pricing' })],
      edits({ nextSteps: { 'opp-1': '' } }),
    );
    expect(result.nextStep).toBe('');
  });

  it('keeps a cleared note cleared', () => {
    const [result] = applySessionEdits(
      [makeOpportunity({ notes: 'Procurement is the blocker' })],
      edits({ notes: { 'opp-1': '' } }),
    );
    expect(result.notes).toBe('');
  });

  it('distinguishes a cleared field from an untouched one', () => {
    const book = [
      makeOpportunity({ id: 'cleared', nextStep: 'Send pricing' }),
      makeOpportunity({ id: 'untouched', nextStep: 'Send pricing' }),
    ];
    const [cleared, untouched] = applySessionEdits(
      book,
      edits({ nextSteps: { cleared: '' } }),
    );
    expect(cleared.nextStep).toBe('');
    expect(untouched.nextStep).toBe('Send pricing');
  });

  it('applies several edits to the same opportunity at once', () => {
    const [result] = applySessionEdits(
      [makeOpportunity({ stage: 'discovery' })],
      edits({
        revenueOverrides: { 'opp-1': 125_000 },
        notes: { 'opp-1': 'Champion left' },
        nextSteps: { 'opp-1': 'Find a new champion' },
        forecastCalls: { 'opp-1': 'long-shot' },
      }),
    );
    expect(result).toMatchObject({
      forecastedRevenue: 125_000,
      notes: 'Champion left',
      nextStep: 'Find a new champion',
      forecastCategory: 'long-shot',
      stage: 'discovery',
    });
  });

  it('ignores edits keyed to opportunities that are not on the book', () => {
    const result = applySessionEdits(
      [makeOpportunity()],
      edits({ revenueOverrides: { 'opp-gone': 1 } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].forecastedRevenue).toBe(250_000);
  });

  it('handles an empty book', () => {
    expect(applySessionEdits([], edits({ notes: { 'opp-1': 'x' } }))).toEqual([]);
  });
});
