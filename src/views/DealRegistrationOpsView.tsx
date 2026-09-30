import { useMemo } from 'react';
import Card from '../components/Card';
import DuplicateRegistrationsTable from '../components/DuplicateRegistrationsTable';
import ExclusivityTable from '../components/ExclusivityTable';
import KpiTile from '../components/KpiTile';
import MetricBars, { type MetricBarRow } from '../components/MetricBars';
import RegistrationsTable from '../components/RegistrationsTable';
import {
  REGISTRATION_EXCLUSIVITY_DAYS,
  REGISTRATION_SLA_BUSINESS_DAYS,
  SNAPSHOT_DATE,
} from '../data/constants';
import type { DashboardData } from '../data/types';
import { formatDate } from '../lib/format';
import {
  approvedNotConverted,
  duplicateRegistrationGroups,
  exclusivityLapsed,
  pendingRegistrations,
  registrationsPastSla,
  registrationConversionTimes,
} from '../lib/metrics';

interface DealRegistrationOpsViewProps {
  data: DashboardData;
}

const fmtDays = (days: number | null) => (days === null ? '—' : `${days.toFixed(1)}d`);

/**
 * Deal Registration Operations: the ops-led view of the registration book.
 * Conversion time runs submitted → approved → opportunity created → win, and
 * every registration is measured against the two service levels — respond
 * within REGISTRATION_SLA_BUSINESS_DAYS business days, and the approved lead
 * keeps exclusivity for REGISTRATION_EXCLUSIVITY_DAYS calendar days. The
 * duplicate/conflict table is internal only.
 */
export default function DealRegistrationOpsView({ data }: DealRegistrationOpsViewProps) {
  const registrations = data.registrations;
  const pending = useMemo(() => pendingRegistrations(registrations), [registrations]);
  const pastSla = useMemo(() => registrationsPastSla(registrations), [registrations]);
  const leaking = useMemo(() => approvedNotConverted(registrations), [registrations]);
  const lapsed = useMemo(() => leaking.filter(exclusivityLapsed), [leaking]);
  const groups = useMemo(
    () => duplicateRegistrationGroups(registrations, data.partners),
    [registrations, data.partners],
  );
  const times = useMemo(
    () => registrationConversionTimes(registrations, data.opportunities),
    [registrations, data.opportunities],
  );

  const timeRows: MetricBarRow[] = [
    {
      label: 'Submitted → Approved',
      value: times.submittedToApprovedBusinessDays ?? 0,
      displayValue: fmtDays(times.submittedToApprovedBusinessDays),
      // The approval hop is measured in the SLA's own unit, so the bar reads
      // directly against the response SLA.
      secondary: 'avg business days · vs 5-business-day SLA',
      color: '#7e7b78',
    },
    {
      label: 'Approved → Opportunity',
      value: times.approvedToOpportunityCalendarDays ?? 0,
      displayValue: fmtDays(times.approvedToOpportunityCalendarDays),
      secondary: 'avg elapsed calendar days · converted registrations',
      color: '#9a9693',
    },
    {
      label: 'Opportunity → Win',
      value: times.opportunityToWinCalendarDays ?? 0,
      displayValue: fmtDays(times.opportunityToWinCalendarDays),
      secondary: 'avg elapsed calendar days · converted & won',
      color: '#a0ca92',
    },
    {
      label: 'Submitted → Win',
      value: times.submittedToWinCalendarDays ?? 0,
      displayValue: fmtDays(times.submittedToWinCalendarDays),
      secondary: 'avg elapsed calendar days · converted & won',
      color: '#b8b3b0',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
          Registration ops · internal
        </p>
        <h1 className="mt-2 text-3xl tracking-tight text-bone">Deal Registration Operations</h1>
        <p className="mt-1 max-w-3xl text-sm text-granite">
          Every registration is measured against two service levels: respond within{' '}
          {REGISTRATION_SLA_BUSINESS_DAYS} business days, and the approved lead keeps exclusivity
          for {REGISTRATION_EXCLUSIVITY_DAYS} calendar days. Snapshot{' '}
          {formatDate(SNAPSHOT_DATE.toISOString())}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiTile
          label="Submitted → approved"
          value={fmtDays(times.submittedToApprovedBusinessDays)}
          sub={`avg business days · ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`}
        />
        <KpiTile
          label="Approved → opportunity"
          value={fmtDays(times.approvedToOpportunityCalendarDays)}
          sub="avg elapsed calendar days · converted regs"
        />
        <KpiTile
          label="Opportunity → win"
          value={fmtDays(times.opportunityToWinCalendarDays)}
          sub="avg elapsed calendar days · converted & won"
        />
        <KpiTile
          label="Submitted → win"
          value={fmtDays(times.submittedToWinCalendarDays)}
          sub="avg elapsed calendar days · converted & won"
        />
        <KpiTile
          label="Pending past SLA"
          value={`${pastSla.length}`}
          sub={`${REGISTRATION_SLA_BUSINESS_DAYS}+ business days awaiting review`}
        />
        <KpiTile
          label="Exclusivity lapsed"
          value={`${lapsed.length}`}
          sub={`approved, no opp · > ${REGISTRATION_EXCLUSIVITY_DAYS} days`}
        />
      </div>

      <Card
        title="Conversion time"
        subtitle="Average days between each step of the chain: submitted → approved → opportunity created → win"
      >
        <MetricBars rows={timeRows} />
        <p className="mt-4 text-xs text-granite">
          Each hop averages only the registrations that reached it. The approval hop is measured in
          business days — the response SLA's own unit; every other hop is elapsed calendar days. The{' '}
          {REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA is the approval step's target; the{' '}
          {REGISTRATION_EXCLUSIVITY_DAYS}-day exclusivity window is the partner's introduction
          deadline after approval.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Registrations awaiting review"
          subtitle={`${pending.length} pending · day counter is green inside the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA, red outside it`}
        >
          <RegistrationsTable
            registrations={pending}
            partners={data.partners}
            variant="queue"
            limit={10}
          />
          <p className="mt-4 text-xs text-granite">
            {pastSla.length} of {pending.length} pending registrations are already past the response
            SLA.
          </p>
        </Card>
        <Card
          title="Exclusivity window"
          subtitle={`${leaking.length} approved registrations still without an opportunity · ${REGISTRATION_EXCLUSIVITY_DAYS}-day window from approval`}
        >
          <ExclusivityTable registrations={leaking} partners={data.partners} limit={8} />
          <p className="mt-4 text-xs text-granite">
            {lapsed.length} of {leaking.length} have passed the {REGISTRATION_EXCLUSIVITY_DAYS}-day
            window and are flagged "Exclusivity lapsed".
          </p>
        </Card>
      </div>

      <Card
        title="Duplicate & conflicting registrations"
        subtitle={`${groups.length} clients registered by more than one partner · submission dates show who registered first · internal only`}
      >
        <DuplicateRegistrationsTable groups={groups} partners={data.partners} limit={8} />
        <p className="mt-4 text-xs text-granite">
          When multiple partners register the same client, the overlap and the earliest submission
          decide exclusivity. This view is never exposed in the partner portal.
        </p>
      </Card>
    </div>
  );
}
