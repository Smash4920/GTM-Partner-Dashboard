import type { SessionEdits } from '../sessionEdits';
import type { Partner } from '../types';

/**
 * Prospect membership for a cursor key: the ids, sorted, so array order
 * cannot mint a different key for the same set. Prospects are roster rows,
 * and the leaderboard is one row per roster partner, so they belong to the
 * query's membership exactly like the drill-down does.
 */
export function prospectIdsKey(prospects: Partner[] | undefined): string {
  return (prospects ?? [])
    .map((partner) => partner.id)
    .sort()
    .join(',');
}

/**
 * Revenue overrides can re-rank the leaderboard, so bind its cursor to the
 * content of the whole map, not its object identity. Notes, next steps and
 * forecast calls never change leaderboard order and deliberately stay out.
 */
export function revenueEditsKey(edits: SessionEdits | undefined): string {
  const overrides = edits?.revenueOverrides ?? {};
  return Object.keys(overrides)
    .sort()
    .map((id) => `${id}=${String(overrides[id])}`)
    .join(',');
}
