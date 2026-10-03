import { useRef, useState } from 'react';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import type { DataProvider, TeamRosterScope } from '../data/DataProvider';
import { useScopedQuery } from '../data/queryState';
import type {
  ForecastChange,
  WorkflowDraft,
  WorkflowRecord,
  WorkflowTarget,
} from '../data/workflows';
import { recordWorkflow, WORKFLOW_OUTCOMES } from '../lib/workflows';
import Card from './Card';
import { renderQueryState } from './QueryState';
import FormField, { focusInvalid } from './FormField';
import Modal from './Modal';

const CONTROL_CLASS = 'rounded border border-ash px-3 py-2 text-sm disabled:opacity-40';
const TITLES = {
  registration: 'Registration decision',
  conflict: 'Partner-conflict disposition',
  forecast: 'Forecast-change review',
};
const NOTICE =
  'Session-only · simulated/local-only. Selected demo actor is not authenticated. Refresh loses these records. No approver enforcement, delivery or write-back.';

interface WorkflowPanelProps {
  provider: DataProvider;
  roster: TeamRosterScope;
  records: readonly WorkflowRecord[];
  changes: readonly ForecastChange[];
  target: WorkflowTarget | null;
  onWorkflow: (target: WorkflowTarget) => void;
  onRecord: (record: WorkflowRecord) => void;
  onClose: () => void;
  now?: () => string;
}

function RecordDetails({ record }: { record: WorkflowRecord }) {
  return (
    <p className="break-words text-xs text-stone">
      {record.kind}: {record.entityIds.join(', ')}
      {record.kind === 'forecast' && ` · ${record.changeId}`} · outcome {record.outcome} · actor{' '}
      {record.actorId} (not authenticated) · reason: {record.reason} · time{' '}
      <time dateTime={record.recordedAt}>{record.recordedAt}</time> · {record.delivery}
    </p>
  );
}

export default function WorkflowPanel(props: WorkflowPanelProps) {
  return (
    <Card title="Session workflows">
      <p className="mb-3 text-xs text-granite">{NOTICE}</p>
      <p className="text-xs text-stone" aria-live="polite">
        {(['registration', 'conflict', 'forecast'] as const)
          .map(
            (kind, index) =>
              `${['Registration decisions', 'Conflict dispositions', 'Forecast reviews'][index]}: ${props.records.filter((record) => record.kind === kind).length}`,
          )
          .join(' · ')}
      </p>
      <p className="mt-2 text-xs text-granite">
        Outcomes update this session projection only. Source queues, metrics and fixtures stay
        unchanged.
      </p>
      <ul aria-label="Session workflow records" className="mt-3 space-y-2">
        {props.records.map((record, index) => (
          <li key={index}>
            <RecordDetails record={record} />
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-granite">
        Current-session forecast edits, not source history or manager/partner trends. Reviews do not
        change the edited forecast. Historical ownership and stage events remain prerequisites for
        the deferred Forecast Quality trend.
      </p>
      <ul aria-label="Current-session forecast changes" className="mt-2 space-y-2">
        {props.changes.map((change) => (
          <li key={change.id} className="flex flex-wrap items-center gap-3 text-xs text-stone">
            <span>
              {change.id} · {change.opportunityId} · {change.field}: {change.value}
            </span>
            <button
              type="button"
              className={CONTROL_CLASS}
              onClick={() =>
                props.onWorkflow({
                  kind: 'forecast',
                  entityIds: [change.opportunityId],
                  changeId: change.id,
                })
              }
            >
              Review {change.id}
            </button>
          </li>
        ))}
      </ul>
      {props.target && (
        <WorkflowDialog key={JSON.stringify(props.target)} {...props} target={props.target} />
      )}
    </Card>
  );
}

function WorkflowDialog({
  provider,
  roster,
  target,
  onRecord,
  onClose,
  now = () => new Date().toISOString(),
}: WorkflowPanelProps & { target: WorkflowTarget }) {
  const draftFocus = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>({ actorId: '', outcome: '', reason: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof WorkflowDraft | 'target', string>>>({});
  const [discard, setDiscard] = useState(false);
  const [saved, setSaved] = useState<WorkflowRecord | null>(null);
  const team = useScopedQuery({
    provider,
    queryKey: `workflow-roster:${JSON.stringify(roster)}`,
    scopeKey: JSON.stringify(roster),
    run: (context) => provider.getTeamRoster(INTERNAL_DEMO_SCOPE, roster, context),
    errorFallback: 'Workflow roster unavailable',
  });
  const requestClose = (draftControl?: HTMLElement) => {
    if (discard) setDiscard(false);
    else if (!saved && Object.values(draft).some(Boolean)) {
      draftFocus.current = draftControl ?? (document.activeElement as HTMLElement);
      setDiscard(true);
    } else onClose();
  };
  const update = (field: keyof WorkflowDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  return (
    <Modal
      title={
        discard
          ? 'Discard unsaved workflow?'
          : saved
            ? 'Session outcome recorded'
            : TITLES[target.kind]
      }
      onDismiss={requestClose}
      returnFocus={!discard && !saved ? draftFocus.current : null}
    >
      {discard ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={CONTROL_CLASS} onClick={() => setDiscard(false)}>
            Keep editing
          </button>
          <button type="button" className={CONTROL_CLASS} onClick={onClose}>
            Discard
          </button>
        </div>
      ) : null}
      <div hidden={discard}>
        <p className="mt-3 text-xs text-granite">{NOTICE}</p>
        <p className="my-3 break-all text-sm">
          {target.entityIds.join(', ')}
          {target.kind === 'forecast' && ` · ${target.changeId}`}
        </p>
        {saved ? (
          <>
            <RecordDetails record={saved} />
            <button type="button" className={`mt-4 ${CONTROL_CLASS}`} onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          renderQueryState('workflow actor roster', team, (users) => (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (team.error || team.refreshing) return;
                const result = recordWorkflow(target, draft, users, now());
                if (!result.ok) {
                  setErrors(result.errors);
                  focusInvalid(event.currentTarget, result.errors);
                  return;
                }
                onRecord(result.record);
                setSaved(result.record);
              }}
            >
              {(['actorId', 'outcome', 'reason'] as const).map((field) => (
                <FormField
                  key={field}
                  label={
                    field === 'actorId'
                      ? 'Demo actor (not authenticated)'
                      : field === 'outcome'
                        ? 'Outcome'
                        : 'Reason'
                  }
                  error={errors[field]}
                >
                  {field === 'reason' ? (
                    <textarea
                      name={field}
                      className={`w-full bg-carbon ${CONTROL_CLASS}`}
                      rows={3}
                      value={draft[field]}
                      onChange={(event) => update(field, event.target.value)}
                    />
                  ) : (
                    <select
                      name={field}
                      className={`w-full bg-carbon ${CONTROL_CLASS}`}
                      value={draft[field]}
                      onChange={(event) => update(field, event.target.value)}
                    >
                      <option value="">
                        Select {field === 'actorId' ? 'active demo actor' : 'outcome'}
                      </option>
                      {field === 'actorId'
                        ? users
                            .filter((user) => user.status === 'active')
                            .map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.name} · {user.id}
                              </option>
                            ))
                        : WORKFLOW_OUTCOMES[target.kind].map((outcome) => (
                            <option key={outcome} value={outcome}>
                              {outcome}
                            </option>
                          ))}
                    </select>
                  )}
                </FormField>
              ))}
              {errors.target && <p role="alert">{errors.target}</p>}
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className={CONTROL_CLASS}
                  disabled={Boolean(team.error) || team.refreshing}
                >
                  Record session outcome
                </button>
                <button type="button" className={CONTROL_CLASS} onClick={() => requestClose()}>
                  Cancel
                </button>
              </div>
            </form>
          ))
        )}
        {!saved && (team.data === null || team.error) && (
          <button type="button" className={`mt-4 ${CONTROL_CLASS}`} onClick={() => requestClose()}>
            Cancel
          </button>
        )}
      </div>
    </Modal>
  );
}
