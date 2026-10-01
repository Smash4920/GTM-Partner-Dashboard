import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const CONTROL_CLASS =
  'rounded border border-ash px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-bone disabled:opacity-40';
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
        Registration decisions:{' '}
        {props.records.filter((record) => record.kind === 'registration').length}
        {' · '}Conflict dispositions:{' '}
        {props.records.filter((record) => record.kind === 'conflict').length}
        {' · '}Forecast reviews:{' '}
        {props.records.filter((record) => record.kind === 'forecast').length}
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
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
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
  useEffect(() => {
    const opener = document.activeElement;
    const modal = dialog.current!;
    modal.showModal();
    return () => {
      modal.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else {
        const routeHeading = document.querySelector<HTMLElement>('main h1');
        routeHeading?.setAttribute('tabindex', '-1');
        routeHeading?.focus();
      }
    };
  }, []);
  useEffect(() => {
    heading.current!.focus();
  }, [discard, saved]);
  const requestClose = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!saved && Object.values(draft).some(Boolean)) setDiscard(!discard);
    else onClose();
  };
  const update = (field: keyof WorkflowDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  return createPortal(
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby="workflow-title"
      onKeyDown={(event) => {
        // Cancel alone can let repeated native Escape requests close Chromium's dialog.
        if (event.key === 'Escape') return requestClose(event);
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea'),
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (
          event.shiftKey
            ? document.activeElement === first || document.activeElement === heading.current
            : document.activeElement === last
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
      onCancel={requestClose}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-card border border-ash bg-canvas p-5 text-bone backdrop:bg-canvas/80"
    >
      <h2 id="workflow-title" ref={heading} tabIndex={-1} className="text-lg">
        {discard
          ? 'Discard unsaved workflow?'
          : saved
            ? 'Session outcome recorded'
            : TITLES[target.kind]}
      </h2>
      {discard ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={CONTROL_CLASS} onClick={() => setDiscard(false)}>
            Keep editing
          </button>
          <button type="button" className={CONTROL_CLASS} onClick={onClose}>
            Discard
          </button>
        </div>
      ) : (
        <>
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
                    dialog.current
                      ?.querySelector<HTMLElement>(`[name="${Object.keys(result.errors)[0]}"]`)
                      ?.focus();
                    return;
                  }
                  onRecord(result.record);
                  setSaved(result.record);
                }}
              >
                {(['actorId', 'outcome', 'reason'] as const).map((field) => (
                  <div key={field}>
                    <label htmlFor={`workflow-${field}`} className="mb-1 block text-sm">
                      {field === 'actorId'
                        ? 'Demo actor (not authenticated)'
                        : field === 'outcome'
                          ? 'Outcome'
                          : 'Reason'}
                    </label>
                    {field === 'reason' ? (
                      <textarea
                        id={`workflow-${field}`}
                        name={field}
                        className={`w-full bg-carbon ${CONTROL_CLASS}`}
                        rows={3}
                        value={draft[field]}
                        aria-invalid={Boolean(errors[field])}
                        aria-describedby={errors[field] ? `workflow-${field}-error` : undefined}
                        onChange={(event) => update(field, event.target.value)}
                      />
                    ) : (
                      <select
                        id={`workflow-${field}`}
                        name={field}
                        className={`w-full bg-carbon ${CONTROL_CLASS}`}
                        value={draft[field]}
                        aria-invalid={Boolean(errors[field])}
                        aria-describedby={errors[field] ? `workflow-${field}-error` : undefined}
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
                    {errors[field] && (
                      <p id={`workflow-${field}-error`} className="mt-1 text-xs text-signal">
                        {errors[field]}
                      </p>
                    )}
                  </div>
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
                  <button type="button" className={CONTROL_CLASS} onClick={requestClose}>
                    Cancel
                  </button>
                </div>
              </form>
            ))
          )}
          {!saved && (team.data === null || team.error) && (
            <button type="button" className={`mt-4 ${CONTROL_CLASS}`} onClick={requestClose}>
              Cancel
            </button>
          )}
        </>
      )}
    </dialog>,
    document.body,
  );
}
