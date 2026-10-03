import {
  REGISTRATION_SLA_BUSINESS_DAYS,
  REGISTRATION_SLA_WARNING_BUSINESS_DAYS,
} from '../data/constants';
import type {
  ActionItem,
  ActionPolicy,
  ActionReason,
  ActionSeverity,
  ActivityMeeting,
  DealRegistration,
  MissingNextStepCause,
  Opportunity,
  Partner,
} from '../data/types';
import { businessDaysAfter, businessDaysBetween } from './fiscal';
import { derivePartnerHealthReasons } from './partnerHealthRules';

export { DEFAULT_ACTION_POLICY } from './actionPolicy';

const DAY = 86_400_000;
const SEVERITY_ORDER: Record<ActionSeverity, number> = { critical: 3, high: 2, medium: 1 };

export interface ActionRuleInput {
  /** Reporting instant from the provider, never the runtime clock. */
  asOf: string;
  policy: Readonly<ActionPolicy>;
  /** Apply demo scope and session overlays before invoking the rules. */
  partners: readonly Partner[];
  opportunities: readonly Opportunity[];
  registrations: readonly DealRegistration[];
  activities: readonly ActivityMeeting[];
  /** Provider-private history reduced to the latest strictly prior close date only. */
  priorCloseDates?: ReadonlyMap<string, string>;
}

function utcDay(iso: string): number {
  const date = new Date(iso);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function calendarDays(from: string, to: string): number {
  return (utcDay(to) - utcDay(from)) / DAY;
}

function staleReason(opportunity: Opportunity, input: ActionRuleInput): ActionReason | undefined {
  if (opportunity.forecastedRevenue < input.policy.highValueAmount) return undefined;
  const basis = opportunity.lastActivityAt === undefined ? 'createdAt' : 'lastActivityAt';
  const baselineAt = opportunity.lastActivityAt ?? opportunity.createdAt;
  const elapsedCalendarDays = calendarDays(baselineAt, input.asOf);
  if (elapsedCalendarDays < input.policy.staleCalendarDays) return undefined;
  return {
    category: 'stale-high-value',
    severity: 'high',
    dueAt: new Date(utcDay(baselineAt) + input.policy.staleCalendarDays * DAY).toISOString(),
    evidence: { basis, baselineAt, elapsedCalendarDays },
    recommendedAction: 'Confirm deal activity and arrange the next meaningful customer touchpoint.',
  };
}

function missingStepReason(
  opportunity: Opportunity,
  input: ActionRuleInput,
): ActionReason | undefined {
  if (opportunity.nextStep?.trim()) return undefined;
  const daysUntilClose = calendarDays(input.asOf, opportunity.expectedCloseDate);
  const causes: MissingNextStepCause[] = [];
  // An overdue close is also inside the horizon; report every qualifying cause.
  if (daysUntilClose <= input.policy.missingNextStepHorizonDays) causes.push('within-horizon');
  if (opportunity.forecastedRevenue >= input.policy.highValueAmount) causes.push('high-value');
  if (daysUntilClose < 0) causes.push('overdue');
  if (causes.length === 0) return undefined;
  return {
    category: 'missing-next-step',
    severity: causes.includes('overdue') ? 'high' : 'medium',
    dueAt: opportunity.expectedCloseDate,
    evidence: { causes, daysUntilClose },
    recommendedAction: 'Record a specific next step with the deal owner.',
  };
}

function closeSlipReason(
  opportunity: Opportunity,
  input: ActionRuleInput,
): ActionReason | undefined {
  const priorCloseDate = input.priorCloseDates?.get(opportunity.id);
  if (priorCloseDate === undefined) return undefined;
  const deltaCalendarDays = calendarDays(priorCloseDate, opportunity.expectedCloseDate);
  if (deltaCalendarDays < input.policy.closeSlipCalendarDays) return undefined;
  return {
    category: 'close-date-slip',
    severity: 'high',
    dueAt: opportunity.expectedCloseDate,
    evidence: {
      priorCloseDate,
      currentCloseDate: opportunity.expectedCloseDate,
      deltaCalendarDays,
    },
    recommendedAction: 'Review the slipped close date and confirm a realistic mutual action plan.',
  };
}

function registrationReason(
  registration: DealRegistration,
  asOf: string,
): ActionReason | undefined {
  if (registration.status !== 'pending') return undefined;
  const businessDaysWaiting = businessDaysBetween(registration.submittedAt, asOf);
  const businessDaysRemaining = REGISTRATION_SLA_BUSINESS_DAYS - businessDaysWaiting;
  if (businessDaysRemaining > REGISTRATION_SLA_WARNING_BUSINESS_DAYS) return undefined;
  const state = businessDaysRemaining <= 0 ? 'breach' : 'warning';
  const dueAt = businessDaysAfter(
    registration.submittedAt,
    REGISTRATION_SLA_BUSINESS_DAYS,
  ).toISOString();
  return {
    category: 'registration-sla',
    severity: state === 'breach' ? 'critical' : 'high',
    dueAt,
    evidence: {
      state,
      submittedAt: registration.submittedAt,
      dueAt,
      businessDaysWaiting,
      businessDaysRemaining,
    },
    recommendedAction: 'Review the pending registration and record an approve or reject decision.',
  };
}

/** Global deterministic order. No locale-dependent comparison or wall-clock reads. */
export function compareActionItems(left: ActionItem, right: ActionItem): number {
  const severity = SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity];
  if (severity !== 0) return severity;
  const leftDue = left.dueAt === undefined ? Infinity : Date.parse(left.dueAt);
  const rightDue = right.dueAt === undefined ? Infinity : Date.parse(right.dueAt);
  if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
  const exposure = right.exposure - left.exposure;
  if (exposure !== 0) return exposure;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function actionItem(
  entityKind: ActionItem['entityKind'],
  entityId: string,
  partnerId: string,
  exposure: number,
  reasons: ActionReason[],
): ActionItem {
  let severity: ActionSeverity = 'medium';
  let dueAt: string | undefined;
  for (const reason of reasons) {
    if (SEVERITY_ORDER[reason.severity] > SEVERITY_ORDER[severity]) severity = reason.severity;
    if (
      reason.dueAt !== undefined &&
      (dueAt === undefined || Date.parse(reason.dueAt) < Date.parse(dueAt))
    ) {
      dueAt = reason.dueAt;
    }
  }
  return {
    id: `${entityKind}:${entityId}`,
    entityKind,
    entityId,
    partnerId,
    exposure,
    severity,
    ...(dueAt === undefined ? {} : { dueAt }),
    reasons,
  };
}

/**
 * Pure reporting projection. Canonical collections have unique IDs; each
 * entity emits once, with category order defined here rather than by input
 * iteration. No raw history, clock, mutation, persistence, transport, or React.
 */
export function deriveActionItems(input: ActionRuleInput): ActionItem[] {
  const items: ActionItem[] = [];
  for (const opportunity of input.opportunities) {
    if (opportunity.closedAt !== undefined || opportunity.outcome !== undefined) continue;
    const reasons = [
      staleReason(opportunity, input),
      missingStepReason(opportunity, input),
      closeSlipReason(opportunity, input),
    ].filter((reason): reason is ActionReason => reason !== undefined);
    if (reasons.length > 0) {
      items.push(
        actionItem(
          'opportunity',
          opportunity.id,
          opportunity.partnerId,
          opportunity.forecastedRevenue,
          reasons,
        ),
      );
    }
  }
  for (const registration of input.registrations) {
    const reason = registrationReason(registration, input.asOf);
    if (reason !== undefined) {
      items.push(
        actionItem('registration', registration.id, registration.partnerId, registration.amount, [
          reason,
        ]),
      );
    }
  }
  for (const { partnerId, reason } of derivePartnerHealthReasons(input)) {
    items.push(actionItem('partner', partnerId, partnerId, 0, [reason]));
  }
  return items.sort(compareActionItems);
}
