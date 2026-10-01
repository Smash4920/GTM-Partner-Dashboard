import type { ActionReason, HealthDriverEvidence } from '../data/types';
import type { ActionRuleInput } from './actionRules';

const DAY = 86_400_000;
type DriverValues = [number, number, number, number];
interface WindowValues {
  prior: DriverValues;
  current: DriverValues;
}
const DRIVERS: readonly HealthDriverEvidence['driver'][] = [
  'partner-meetings',
  'opportunities-created',
  'registrations-submitted',
  'closed-won-revenue',
];
const UNITS: readonly HealthDriverEvidence['unit'][] = [
  'meetings',
  'opportunities',
  'registrations',
  'USD',
];

/** One pass per event collection, not one collection scan per partner. */
export function derivePartnerHealthReasons(
  input: ActionRuleInput,
): { partnerId: string; reason: ActionReason }[] {
  const end = Date.parse(input.asOf);
  const middle = end - input.policy.healthWindowDays * DAY;
  const start = middle - input.policy.healthWindowDays * DAY;
  const values = new Map<string, WindowValues>(
    input.partners.map((partner) => [partner.id, { prior: [0, 0, 0, 0], current: [0, 0, 0, 0] }]),
  );
  const add = (partnerId: string, iso: string, driver: number, value: number) => {
    const totals = values.get(partnerId);
    if (totals === undefined) return;
    const instant = Date.parse(iso);
    if (instant <= start || instant > end) return;
    const window = instant <= middle ? totals.prior : totals.current;
    window[driver] = window[driver]! + value;
  };
  for (const meeting of input.activities) add(meeting.partnerId, meeting.occurredAt, 0, 1);
  // Revenue can be fractional. A stable summation order prevents shuffled
  // input changing evidence through floating-point addition order.
  const opportunities = [...input.opportunities].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const opportunity of opportunities) {
    add(opportunity.partnerId, opportunity.createdAt, 1, 1);
    if (opportunity.outcome === 'won' && opportunity.closedAt !== undefined) {
      add(opportunity.partnerId, opportunity.closedAt, 3, opportunity.forecastedRevenue);
    }
  }
  for (const registration of input.registrations) {
    add(registration.partnerId, registration.submittedAt, 2, 1);
  }
  const results: { partnerId: string; reason: ActionReason }[] = [];
  for (const [partnerId, totals] of values) {
    const drivers: HealthDriverEvidence[] = [];
    for (const [index, driver] of DRIVERS.entries()) {
      const prior = totals.prior[index]!;
      const current = totals.current[index]!;
      if (current < prior) drivers.push({ driver, prior, current, unit: UNITS[index]! });
    }
    if (drivers.length < input.policy.minimumDeterioratingDrivers) continue;
    results.push({
      partnerId,
      reason: {
        category: 'partner-health',
        severity: 'medium',
        evidence: {
          priorWindow: {
            startExclusive: new Date(start).toISOString(),
            endInclusive: new Date(middle).toISOString(),
          },
          currentWindow: {
            startExclusive: new Date(middle).toISOString(),
            endInclusive: new Date(end).toISOString(),
          },
          drivers,
        },
        recommendedAction: 'Review the deteriorating partner drivers and agree a recovery plan.',
      },
    });
  }
  return results;
}
