import Card from '../components/Card';
import DuplicateRegistrationsTable from '../components/DuplicateRegistrationsTable';
import ExclusivityTable from '../components/ExclusivityTable';
import KpiTile from '../components/KpiTile';
import MetricBars from '../components/MetricBars';
import { QueryFailure, renderQueryState, useRetryRecovery } from '../components/QueryState';
import PageFooter from '../components/PageFooter';
import RegistrationsTable from '../components/RegistrationsTable';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import {
  REGISTRATION_EXCLUSIVITY_DAYS,
  REGISTRATION_SLA_BUSINESS_DAYS,
  SNAPSHOT_DATE,
} from '../data/constants';
import type { DataProvider, RegistrationOpsSummary } from '../data/DataProvider';
import { pageWindowAsQuery } from '../data/paginationState';
import type { PaginationState } from '../data/paginationState';
import type { QueryState } from '../data/queryState';
import { useRegistrationOpsQueries } from '../data/useRegistrationOpsQueries';
import type { DealRegistration, Partner } from '../data/types';
import type { WorkflowActions } from '../data/workflows';
import { formatDate, formatDays } from '../lib/format';
import type { DuplicateRegistrationGroup } from '../lib/metrics';
import { conversionRows } from './performanceRows';

/** The review queue: pending registrations, oldest first, a page at a time. */
function ReviewQueueCard({
  pending,
  ops,
  roster,
  onWorkflow,
}: {
  pending: PaginationState<DealRegistration>;
  ops: QueryState<RegistrationOpsSummary>;
  roster: Partner[];
} & WorkflowActions) {
  return (
    <Card
      title="Registrations awaiting review"
      subtitle={
        pending.meta === null
          ? `Day counter is green inside the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA, red outside it`
          : `${pending.totalCount} pending · day counter is green inside the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA, red outside it`
      }
    >
      {renderQueryState('review queue', pageWindowAsQuery(pending), (rows) => (
        <>
          <RegistrationsTable
            registrations={rows}
            partners={roster}
            variant="queue"
            limit={rows.length}
            onWorkflow={onWorkflow}
          />
          {ops.data !== null && (
            <p className="mt-4 text-xs text-granite">
              {ops.data.pastSla} of {pending.totalCount} pending registrations are already past the
              response SLA.
            </p>
          )}
          <PageFooter state={pending} noun="pending" pageSize={10} />
        </>
      ))}
    </Card>
  );
}

/** The exclusivity watch: approved registrations that never became opportunities. */
function ExclusivityCard({
  unconverted,
  ops,
  roster,
}: {
  unconverted: PaginationState<DealRegistration>;
  ops: QueryState<RegistrationOpsSummary>;
  roster: Partner[];
}) {
  return (
    <Card
      title="Exclusivity window"
      subtitle={
        ops.data === null
          ? `Approved registrations still without an opportunity · ${REGISTRATION_EXCLUSIVITY_DAYS}-day window from approval`
          : `${ops.data.approvedNotConverted} approved registrations still without an opportunity · ${REGISTRATION_EXCLUSIVITY_DAYS}-day window from approval`
      }
    >
      {renderQueryState('unconverted registrations', pageWindowAsQuery(unconverted), (rows) => (
        <>
          <ExclusivityTable registrations={rows} partners={roster} limit={rows.length} />
          {ops.data !== null && (
            <p className="mt-4 text-xs text-granite">
              {ops.data.exclusivityLapsed} of {ops.data.approvedNotConverted} have passed the{' '}
              {REGISTRATION_EXCLUSIVITY_DAYS}-day window and are flagged "Exclusivity lapsed".
            </p>
          )}
          <PageFooter state={unconverted} noun="unconverted" pageSize={8} />
        </>
      ))}
    </Card>
  );
}

/** The duplicate-registration card: clients registered by more than one partner. */
function DuplicatesCard({
  duplicates,
  roster,
  onWorkflow,
}: {
  duplicates: PaginationState<DuplicateRegistrationGroup>;
  roster: Partner[];
} & WorkflowActions) {
  return (
    <Card
      title="Duplicate & conflicting registrations"
      subtitle={
        duplicates.meta === null
          ? 'Clients registered by more than one partner · submission dates show who registered first · internal only'
          : `${duplicates.totalCount} clients registered by more than one partner · submission dates show who registered first · internal only`
      }
    >
      {renderQueryState('duplicate registrations', pageWindowAsQuery(duplicates), (groups) => (
        <>
          <DuplicateRegistrationsTable
            groups={groups}
            partners={roster}
            limit={groups.length}
            onWorkflow={onWorkflow}
          />
          <PageFooter state={duplicates} noun="duplicate groups" pageSize={8} />
        </>
      ))}
      <p className="mt-4 text-xs text-granite">
        When multiple partners register the same client, the overlap and the earliest submission
        decide exclusivity. This view is never exposed in the partner portal.
      </p>
    </Card>
  );
}

/**
 * Deal Registration Operations: the ops-led view of the registration book.
 * Conversion time runs submitted → approved → opportunity created → win, and
 * every registration is measured against the two service levels — respond
 * within REGISTRATION_SLA_BUSINESS_DAYS business days, and the approved lead
 * keeps exclusivity for REGISTRATION_EXCLUSIVITY_DAYS calendar days. The
 * duplicate/conflict table is internal only.
 *
 * The route reads the scoped contract: the KPI tiles and conversion chart are
 * one ops aggregate, the three tables are cursor-paginated row collections,
 * and every card carries its own loading, error, retry, and metadata state
 * rather than a share of a whole-book load.
 */
export default function DealRegistrationOpsView({
  provider,
  prospects,
  onWorkflow,
}: {
  provider: DataProvider;
  prospects: Partner[];
} & WorkflowActions) {
  const queries = useRegistrationOpsQueries({
    provider,
    access: INTERNAL_DEMO_SCOPE,
    prospects,
  });
  const roster = queries.roster.data ?? [];
  // The roster names the partner column of every table below. Its failure
  // must not take the cards down with it: they keep rendering with the
  // explicit partner-id fallback, and the named retry repeats only the
  // roster query. The region persists across the recovery so the successful
  // retry has a stable focus target.
  const rosterRecovery = useRetryRecovery('partner roster', queries.roster.error !== null);

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

      {renderQueryState('registration ops summary', queries.ops, (ops) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiTile
            label="Submitted → approved"
            value={formatDays(ops.times.submittedToApprovedBusinessDays)}
            sub={`avg business days · ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`}
          />
          <KpiTile
            label="Approved → opportunity"
            value={formatDays(ops.times.approvedToOpportunityCalendarDays)}
            sub="avg elapsed calendar days · converted regs"
          />
          <KpiTile
            label="Opportunity → win"
            value={formatDays(ops.times.opportunityToWinCalendarDays)}
            sub="avg elapsed calendar days · converted & won"
          />
          <KpiTile
            label="Submitted → win"
            value={formatDays(ops.times.submittedToWinCalendarDays)}
            sub="avg elapsed calendar days · converted & won"
          />
          <KpiTile
            label="Pending past SLA"
            value={`${ops.pastSla}`}
            sub={`${REGISTRATION_SLA_BUSINESS_DAYS}+ business days awaiting review`}
          />
          <KpiTile
            label="Exclusivity lapsed"
            value={`${ops.exclusivityLapsed}`}
            sub={`approved, no opp · > ${REGISTRATION_EXCLUSIVITY_DAYS} days`}
          />
        </div>
      ))}

      <Card
        title="Conversion time"
        subtitle="Average days between each step of the chain: submitted → approved → opportunity created → win"
      >
        {renderQueryState('registration conversion times', queries.ops, (ops) => (
          <MetricBars
            rows={conversionRows(ops.times, 'avg business days · vs 5-business-day SLA')}
          />
        ))}
        <p className="mt-4 text-xs text-granite">
          Each hop averages only the registrations that reached it. The approval hop is measured in
          business days — the response SLA's own unit; every other hop is elapsed calendar days. The{' '}
          {REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA is the approval step's target; the{' '}
          {REGISTRATION_EXCLUSIVITY_DAYS}-day exclusivity window is the partner's introduction
          deadline after approval.
        </p>
      </Card>

      {(queries.roster.data !== null || queries.roster.error !== null) && (
        <div ref={rosterRecovery.regionRef} {...rosterRecovery.regionProps}>
          {queries.roster.error !== null && (
            <QueryFailure
              text="Partner names unavailable — showing partner ids"
              retryLabel="partner roster"
              error={queries.roster.error}
              onRetry={rosterRecovery.armRetry(queries.roster.retry)}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReviewQueueCard
          pending={queries.pending}
          ops={queries.ops}
          roster={roster}
          onWorkflow={onWorkflow}
        />
        <ExclusivityCard unconverted={queries.unconverted} ops={queries.ops} roster={roster} />
      </div>

      <DuplicatesCard duplicates={queries.duplicates} roster={roster} onWorkflow={onWorkflow} />
    </div>
  );
}
