import type { ChipOption } from '../components/FilterChips';
import type { MetricBarRow } from '../components/MetricBars';
import {
  LOST_COLOR,
  REGISTRATION_EXCLUSIVITY_DAYS,
  REGISTRATION_SLA_BUSINESS_DAYS,
  STAGE_META,
  WON_COLOR,
} from '../data/constants';
import type { RegistrationOpsSummary, StageBreakdown } from '../data/DataProvider';
import { formatDays, formatUsdCompact } from '../lib/format';
import type { RegistrationConversionTimes, RegistrationFunnel } from '../lib/metrics';

/** Business days for approval; elapsed calendar days for the remaining hops. */
export function conversionRows(
  times: RegistrationConversionTimes,
  approvalSecondary: string,
): MetricBarRow[] {
  const rows: [string, number | null, string, string][] = [
    ['Submitted → Approved', times.submittedToApprovedBusinessDays, approvalSecondary, '#7e7b78'],
    [
      'Approved → Opportunity',
      times.approvedToOpportunityCalendarDays,
      'avg elapsed calendar days · converted registrations',
      '#9a9693',
    ],
    [
      'Opportunity → Win',
      times.opportunityToWinCalendarDays,
      'avg elapsed calendar days · converted & won',
      '#a0ca92',
    ],
    [
      'Submitted → Win',
      times.submittedToWinCalendarDays,
      'avg elapsed calendar days · converted & won',
      '#b8b3b0',
    ],
  ];
  return rows.map(([label, days, secondary, color]) => ({
    label,
    value: days ?? 0,
    displayValue: formatDays(days),
    secondary,
    color,
  }));
}

/** What the registration funnel loses, as counts (shared by Partner Performance and Deal Reg Ops). */
export function leakageRows(ops: RegistrationOpsSummary): MetricBarRow[] {
  return [
    {
      label: 'Approved, no opp',
      value: ops.approvedNotConverted,
      displayValue: `${ops.approvedNotConverted}`,
      secondary: 'approved registrations',
      color: '#8a8380',
    },
    {
      label: 'Exclusivity lapsed',
      value: ops.exclusivityLapsed,
      displayValue: `${ops.exclusivityLapsed}`,
      secondary: `> ${REGISTRATION_EXCLUSIVITY_DAYS} days since approval`,
      color: '#ee6018',
    },
    {
      label: 'Pending past SLA',
      value: ops.pastSla,
      displayValue: `${ops.pastSla}`,
      secondary: `${REGISTRATION_SLA_BUSINESS_DAYS}+ business days awaiting review`,
      color: '#ee6018',
    },
    {
      label: 'Duplicate clients',
      value: ops.duplicateGroups,
      displayValue: `${ops.duplicateGroups}`,
      secondary: 'same client, multiple partners',
      color: '#4d4947',
    },
  ];
}

export type FunnelMeasure = 'value' | 'count';

/** The funnel's measure toggle; Registered $ is the default on every route. */
export const FUNNEL_MEASURE_OPTIONS: ChipOption<FunnelMeasure>[] = [
  { id: 'value', label: 'Registered $', title: 'Partner-estimated deal value at submission' },
  { id: 'count', label: 'Count', title: 'Number of registrations' },
];

export function funnelSubtitle(measure: FunnelMeasure, phaseLabel: string): string {
  return measure === 'value'
    ? `Partner-estimated value at submission · ${phaseLabel}`
    : `Registration counts · ${phaseLabel}`;
}

export function funnelRows(funnel: RegistrationFunnel, measure: FunnelMeasure): MetricBarRow[] {
  const rows: [string, number, number, string, boolean?][] = [
    ['Submitted', funnel.submitted, funnel.submittedValue, '#8a8380'],
    ['Approved', funnel.approved, funnel.approvedValue, '#b8b3b0'],
    ['Converted to opp', funnel.converted, funnel.convertedValue, '#a0ca92'],
    ['Rejected', funnel.rejected, funnel.rejectedValue, '#4d4947', true],
    ['Pending review', funnel.pending, funnel.pendingValue, '#ee6018'],
  ];
  return rows.map(([label, count, amount, color, dimmed]) => ({
    label,
    value: measure === 'value' ? amount : count,
    displayValue: measure === 'value' ? formatUsdCompact(amount) : `${count}`,
    secondary: measure === 'value' ? `${count} regs` : formatUsdCompact(amount),
    color,
    dimmed,
  }));
}

/**
 * Stage bars shared by Home and Partner Performance: the open stages of the
 * scoped breakdown, then the closed won/lost outcomes for the same scope
 * underneath them.
 */
export function stageRows(breakdown: StageBreakdown, outcomeScope: string): MetricBarRow[] {
  return [
    ...breakdown.stages.map((row) => ({
      label: STAGE_META[row.stage].label,
      value: row.value,
      displayValue: formatUsdCompact(row.value),
      secondary: `${row.count} open`,
      color: STAGE_META[row.stage].color,
    })),
    {
      label: `Won (${outcomeScope})`,
      value: breakdown.outcomes.wonValue,
      displayValue: formatUsdCompact(breakdown.outcomes.wonValue),
      secondary: `${breakdown.outcomes.wonCount} won`,
      color: WON_COLOR,
    },
    {
      label: `Lost (${outcomeScope})`,
      value: breakdown.outcomes.lostValue,
      displayValue: formatUsdCompact(breakdown.outcomes.lostValue),
      secondary: `${breakdown.outcomes.lostCount} lost`,
      color: LOST_COLOR,
      dimmed: true,
    },
  ];
}
