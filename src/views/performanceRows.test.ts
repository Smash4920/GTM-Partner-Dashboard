import { describe, expect, it } from 'vitest';
import {
  conversionRows,
  FUNNEL_MEASURE_OPTIONS,
  funnelRows,
  funnelSubtitle,
  leakageRows,
} from './performanceRows';
import type { RegistrationOpsSummary } from '../data/DataProvider';
import type { RegistrationFunnel } from '../lib/metrics';

const FUNNEL: RegistrationFunnel = {
  submitted: 10,
  submittedValue: 1_000_000,
  approved: 4,
  approvedValue: 400_000,
  converted: 2,
  convertedValue: 250_000,
  rejected: 3,
  rejectedValue: 300_000,
  pending: 3,
  pendingValue: 300_000,
};
const LABELS = ['Submitted', 'Approved', 'Converted to opp', 'Rejected', 'Pending review'];
const COLORS = ['#8a8380', '#b8b3b0', '#a0ca92', '#4d4947', '#ee6018'];

describe('shared registration row parity', () => {
  it.each([
    {
      measure: 'count' as const,
      values: [10, 4, 2, 3, 3],
      display: ['10', '4', '2', '3', '3'],
      secondary: ['$1M', '$400K', '$250K', '$300K', '$300K'],
    },
    {
      measure: 'value' as const,
      values: [1_000_000, 400_000, 250_000, 300_000, 300_000],
      display: ['$1M', '$400K', '$250K', '$300K', '$300K'],
      secondary: ['10 regs', '4 regs', '2 regs', '3 regs', '3 regs'],
    },
  ])(
    'preserves the $measure funnel order, values, copy and colors',
    ({ measure, values, display, secondary }) => {
      expect(funnelRows(FUNNEL, measure)).toEqual(
        LABELS.map((label, index) => ({
          label,
          value: values[index],
          displayValue: display[index],
          secondary: secondary[index],
          color: COLORS[index],
          dimmed: index === 3 ? true : undefined,
        })),
      );
    },
  );

  it('keeps zero count/value rows rather than omitting them', () => {
    const empty = Object.fromEntries(
      Object.keys(FUNNEL).map((key) => [key, 0]),
    ) as unknown as RegistrationFunnel;
    expect(
      funnelRows(empty, 'count').map((row) => [row.value, row.displayValue, row.secondary]),
    ).toEqual(Array.from({ length: 5 }, () => [0, '0', '$0']));
    expect(
      funnelRows(empty, 'value').map((row) => [row.value, row.displayValue, row.secondary]),
    ).toEqual(Array.from({ length: 5 }, () => [0, '$0', '0 regs']));
  });

  it.each(['avg business days · 5-business-day SLA', 'avg business days · vs 5-business-day SLA'])(
    'preserves approval copy "%s" and distinguishes missing, zero and rounded days',
    (approvalSecondary) => {
      expect(
        conversionRows(
          {
            submittedToApprovedBusinessDays: null,
            approvedToOpportunityCalendarDays: 0,
            opportunityToWinCalendarDays: 1.25,
            submittedToWinCalendarDays: 20,
          },
          approvalSecondary,
        ),
      ).toEqual([
        {
          label: 'Submitted → Approved',
          value: 0,
          displayValue: '—',
          secondary: approvalSecondary,
          color: '#7e7b78',
        },
        {
          label: 'Approved → Opportunity',
          value: 0,
          displayValue: '0.0d',
          secondary: 'avg elapsed calendar days · converted registrations',
          color: '#9a9693',
        },
        {
          label: 'Opportunity → Win',
          value: 1.25,
          displayValue: '1.3d',
          secondary: 'avg elapsed calendar days · converted & won',
          color: '#a0ca92',
        },
        {
          label: 'Submitted → Win',
          value: 20,
          displayValue: '20.0d',
          secondary: 'avg elapsed calendar days · converted & won',
          color: '#b8b3b0',
        },
      ]);
    },
  );

  it('renders all missing hops with zero-size bars and em dashes', () => {
    const rows = conversionRows(
      {
        submittedToApprovedBusinessDays: null,
        approvedToOpportunityCalendarDays: null,
        opportunityToWinCalendarDays: null,
        submittedToWinCalendarDays: null,
      },
      'avg business days · 5-business-day SLA',
    );
    expect(rows.map((row) => [row.value, row.displayValue])).toEqual(
      Array.from({ length: 4 }, () => [0, '—']),
    );
  });
});

describe('the funnel measure toggle', () => {
  it('offers Registered $ first, and both measures name their subtitle', () => {
    expect(FUNNEL_MEASURE_OPTIONS.map((option) => [option.id, option.label])).toEqual([
      ['value', 'Registered $'],
      ['count', 'Count'],
    ]);
    expect(funnelSubtitle('value', 'Q3')).toBe('Partner-estimated value at submission · Q3');
    expect(funnelSubtitle('count', 'FY')).toBe('Registration counts · FY');
  });
});

describe('the shared registration leakage rows', () => {
  it('reads one row per leak from the ops aggregate, in funnel order', () => {
    const ops: RegistrationOpsSummary = {
      times: {
        submittedToApprovedBusinessDays: 2,
        approvedToOpportunityCalendarDays: 4,
        opportunityToWinCalendarDays: 10,
        submittedToWinCalendarDays: 21,
      },
      pending: 6,
      approvedNotConverted: 4,
      exclusivityLapsed: 2,
      pastSla: 3,
      duplicateGroups: 1,
    };
    expect(leakageRows(ops)).toEqual([
      {
        label: 'Approved, no opp',
        value: 4,
        displayValue: '4',
        secondary: 'approved registrations',
        color: '#8a8380',
      },
      {
        label: 'Exclusivity lapsed',
        value: 2,
        displayValue: '2',
        secondary: '> 60 days since approval',
        color: '#ee6018',
      },
      {
        label: 'Pending past SLA',
        value: 3,
        displayValue: '3',
        // The boundary is inclusive: the copy says 5+, never "> 5".
        secondary: '5+ business days awaiting review',
        color: '#ee6018',
      },
      {
        label: 'Duplicate clients',
        value: 1,
        displayValue: '1',
        secondary: 'same client, multiple partners',
        color: '#4d4947',
      },
    ]);
  });
});
