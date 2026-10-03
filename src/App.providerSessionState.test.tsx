import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { DataProvider } from './data/DataProvider';
import { INTERNAL_DEMO_SCOPE } from './data/accessScope';
import { MockDataProvider } from './data/mock/MockDataProvider';
import type { ProviderId } from './data/providers';
import type { WorkflowRecord, WorkflowTarget } from './data/workflows';
import { DEFAULT_ACTION_POLICY } from './lib/actionPolicy';
import { providerSessionBook } from './test/providerSessionFixtures';
import type ForecastingView from './views/ForecastingView';
import type ActivityTrackingView from './views/ActivityTrackingView';
import type SettingsView from './views/SettingsView';
import type ActionCenterView from './views/ActionCenterView';
import type WorkflowPanel from './components/WorkflowPanel';

type ForecastProps = ComponentProps<typeof ForecastingView>;
type ActivityProps = ComponentProps<typeof ActivityTrackingView>;
type SettingsProps = ComponentProps<typeof SettingsView>;
type ActionProps = ComponentProps<typeof ActionCenterView>;
type WorkflowProps = ComponentProps<typeof WorkflowPanel>;

// Shell inventory cases observe inputs and dispatch intents without paying for
// every chart on every edit. The selection cases render the real views below.
// Both modes use the existing providerFactory/probeProvider seams.
const observed = vi.hoisted(() => ({
  renderViews: false,
  forecast: [] as ForecastProps[],
  activity: [] as ActivityProps[],
  settings: [] as SettingsProps[],
  actions: [] as ActionProps[],
  workflow: [] as WorkflowProps[],
}));
// Home is only the landing route here; App.test.tsx owns its real-view proof.
vi.mock('./views/HomeView', () => ({
  default: () => <h1>Provider session matrix landing</h1>,
}));
vi.mock('./views/ForecastingView', async (importOriginal) => {
  const { default: View } = await importOriginal<typeof import('./views/ForecastingView')>();
  return {
    default: (props: ForecastProps) => {
      observed.forecast.push(props);
      return observed.renderViews ? <View {...props} /> : <p>Forecast shell inputs</p>;
    },
  };
});
vi.mock('./views/ActivityTrackingView', async (importOriginal) => {
  const { default: View } = await importOriginal<typeof import('./views/ActivityTrackingView')>();
  return {
    default: (props: ActivityProps) => {
      observed.activity.push(props);
      return observed.renderViews ? <View {...props} /> : <p>Activity shell inputs</p>;
    },
  };
});
vi.mock('./views/system', async (importOriginal) => {
  const module = await importOriginal<typeof import('./views/system')>();
  return {
    ...module,
    // Settings carries the session roster surfaces Data Connections used to
    // own; the connection catalog itself is static and observes nothing.
    ['SettingsView']: (props: SettingsProps) => {
      observed.settings.push(props);
      return observed.renderViews ? <module.SettingsView {...props} /> : <p>Roster shell inputs</p>;
    },
  };
});
vi.mock('./views/ActionCenterView', async (importOriginal) => {
  const { default: View } = await importOriginal<typeof import('./views/ActionCenterView')>();
  return {
    default: (props: ActionProps) => {
      observed.actions.push(props);
      return observed.renderViews ? <View {...props} /> : <p>Action shell inputs</p>;
    },
  };
});
vi.mock('./components/WorkflowPanel', async (importOriginal) => {
  const { default: Panel } = await importOriginal<typeof import('./components/WorkflowPanel')>();
  return {
    default: (props: WorkflowProps) => {
      observed.workflow.push(props);
      return observed.renderViews ? <Panel {...props} /> : <p>Workflow shell inputs</p>;
    },
  };
});
vi.mock('./views/DealRegistrationOpsView', async (importOriginal) => {
  const { default: View } =
    await importOriginal<typeof import('./views/DealRegistrationOpsView')>();
  return {
    default: (props: ComponentProps<typeof View>) =>
      observed.renderViews ? <View {...props} /> : <p>Registration shell route</p>,
  };
});

const latest = <T,>(values: T[]): T => values[values.length - 1]!;
const nav = () => within(screen.getByRole('navigation', { name: 'Primary' }));
async function visit(label: string) {
  fireEvent.click(nav().getByText(label, { exact: true }));
  await settle();
}
async function settle() {
  // QueryLoading always exposes role=status. Avoid rescanning chart SVG text
  // on every poll while preserving the same initial-loading assertion.
  await waitFor(
    () => {
      const loading = Array.from(document.querySelectorAll('[role="status"]')).filter((node) =>
        /^Loading /.test(node.textContent?.trim() ?? ''),
      );
      expect(loading).toHaveLength(0);
    },
    { interval: 1 },
  );
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function setup(collision = false) {
  const books = {
    local: providerSessionBook('LOCAL', collision ? 'shared' : 'LOCAL'),
    remote: providerSessionBook('REMOTE', collision ? 'shared' : 'REMOTE'),
  };
  const providers = {
    local: new MockDataProvider(books.local),
    remote: new MockDataProvider(books.remote, { providerId: 'remote' }),
  };
  const probes: {
    candidate: DataProvider;
    signal: AbortSignal;
    resolve: () => void;
    reject: () => void;
  }[] = [];
  const probe = (candidate: DataProvider, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      probes.push({ candidate, signal, resolve, reject: () => reject(new Error('readiness')) });
    });
  render(
    <App
      providerFactory={(id) => providers[id === 'local' ? 'local' : 'remote']}
      probeProvider={probe}
    />,
  );
  return { books, providers, probes };
}
type Harness = ReturnType<typeof setup>;

async function request(harness: Harness, id: ProviderId) {
  const before = harness.probes.length;
  change('Data provider', id);
  await waitFor(() => expect(harness.probes).toHaveLength(before + 1));
  return latest(harness.probes);
}
async function commit(harness: Harness, id: ProviderId) {
  const gate = await request(harness, id);
  await act(async () => gate.resolve());
  await settle();
}
function clearTrace() {
  for (const frames of [
    observed.forecast,
    observed.activity,
    observed.settings,
    observed.actions,
    observed.workflow,
  ])
    frames.length = 0;
}

beforeAll(async () => {
  // Cold-chunk delivery is independently tested in the production browser.
  await Promise.all([
    import('./views/system'),
    import('./views/ActionCenterView'),
    import('./components/WorkflowPanel'),
  ]);
});

beforeEach(() => {
  clearTrace();
  observed.renderViews = false;
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

async function seedSession(harness: Harness, id: 'local' | 'remote') {
  const book = harness.books[id];
  const opportunity = book.opportunities[0];
  const actor = book.teamUsers[0];
  await visit('Forecasting');
  act(() => {
    const props = latest(observed.forecast);
    props.onSetRevenue(opportunity.id, 987_654);
    props.onSetForecastCall(opportunity.id, 'commit');
    props.onSetNote(opportunity.id, `${id} session note`);
    props.onSetNextStep(opportunity.id, `${id} session next step`);
  });
  await visit('Activity Tracking');
  act(() => {
    const props = latest(observed.activity);
    const prospectId = props.onAddPartner(`${id} prospect`, book.partnerManagers[0].id);
    props.onCommitClassifications({
      [book.activities[0].id]: { partnerId: prospectId, type: 'technical-enablement' },
    });
  });
  await visit('Settings');
  act(() => {
    const props = latest(observed.settings);
    props.onSetTeamUserStatus(book.teamUsers[1].id, 'suspended');
    props.onAddTeamUser({
      name: `${id} removed`,
      email: 'removed@example.test',
      role: 'analyst',
      channels: ['email'],
    });
  });
  act(() => latest(observed.settings).onSetTeamUserStatus('session-user-1', 'active'));
  const removed = latest(observed.settings).addedTeamUsers[0];
  act(() => latest(observed.settings).onRemoveTeamUser(removed.id));
  act(() =>
    latest(observed.settings).onAddTeamUser({
      name: `${id} remaining`,
      email: 'remaining@example.test',
      role: 'analyst',
      channels: ['email'],
    }),
  );
  act(() => latest(observed.settings).onSetTeamUserStatus('session-user-2', 'active'));
  act(() =>
    latest(observed.settings).onSendNotification(
      {
        userId: actor.id,
        kind: 'manual',
        subject: `${id} subject`,
        body: `${id} body`,
        channels: ['email'],
      },
      { provider: harness.providers[id], recipient: actor },
    ),
  );
  await visit('Action Center');
  act(() =>
    latest(observed.actions).onPolicyChange({ ...DEFAULT_ACTION_POLICY, staleCalendarDays: 1 }),
  );
  await settle();
  const targets: WorkflowTarget[] = [
    { kind: 'registration', entityIds: [book.registrations[0].id] },
    { kind: 'conflict', entityIds: book.registrations.map((registration) => registration.id) },
    { kind: 'forecast', entityIds: [opportunity.id], changeId: 'change-1' },
  ];
  const records: WorkflowRecord[] = targets.map((target, index) => ({
    ...target,
    actorId: actor.id,
    outcome: ['approved', 'share-credit', 'accepted'][index],
    reason: `${id} reason ${index}`,
    recordedAt: '2026-09-18T12:00:00.000Z',
    delivery: 'simulated/local-only',
  }));
  act(() => records.forEach((record) => latest(observed.workflow).onRecord(record)));
  const actions = await harness.providers[id].listActionItems(
    INTERNAL_DEMO_SCOPE,
    { policy: DEFAULT_ACTION_POLICY },
    { limit: 25 },
  );
  const item = actions.data.rows.find(
    (row) => row.id === `registration:${book.registrations[0].id}`,
  )!;
  expect(item).toBeDefined();
  act(() => latest(observed.actions).onOpenContext!(item));
  act(() => latest(observed.workflow).onWorkflow(targets[0]));
  return { records, targets, removed };
}

function expectSeeded(harness: Harness, id: 'local' | 'remote') {
  const book = harness.books[id];
  const forecast = latest(observed.forecast);
  expect(forecast.provider).toBe(harness.providers[id]);
  expect(forecast.edits).toEqual({
    revenueOverrides: { [book.opportunities[0].id]: 987_654 },
    forecastCalls: { [book.opportunities[0].id]: 'commit' },
    notes: { [book.opportunities[0].id]: `${id} session note` },
    nextSteps: { [book.opportunities[0].id]: `${id} session next step` },
  });
  const activity = latest(observed.activity);
  expect(activity.prospects).toMatchObject([{ id: 'prospect-1', name: `${id} prospect` }]);
  expect(activity.classifications).toEqual({
    [book.activities[0].id]: { partnerId: 'prospect-1', type: 'technical-enablement' },
  });
  const settings = latest(observed.settings);
  expect(settings.teamUserOverrides).toMatchObject({
    [book.teamUsers[1].id]: { status: 'suspended' },
  });
  expect(settings.addedTeamUsers).toMatchObject([
    { id: 'session-user-2', name: `${id} remaining`, status: 'active' },
  ]);
  expect(settings.notifications).toMatchObject([
    { id: 'notification-1', userId: book.teamUsers[0].id, subject: `${id} subject` },
  ]);
  expect(latest(observed.actions).policy.staleCalendarDays).toBe(1);
  expect(latest(observed.workflow).changes).toEqual([
    { id: 'change-2', opportunityId: book.opportunities[0].id, field: 'category', value: 'commit' },
    { id: 'change-1', opportunityId: book.opportunities[0].id, field: 'revenue', value: 987_654 },
  ]);
  expect(latest(observed.workflow).records.map((record) => record.kind)).toEqual([
    'forecast',
    'conflict',
    'registration',
  ]);
  expect(latest(observed.workflow).target).toEqual({
    kind: 'registration',
    entityIds: [book.registrations[0].id],
  });
  expect(screen.getByRole('region', { name: 'Action context' })).toHaveTextContent(
    `registration:${book.registrations[0].id}`,
  );
}

function expectCleanFrames(provider: DataProvider) {
  const emptyEdits = { revenueOverrides: {}, notes: {}, nextSteps: {}, forecastCalls: {} };
  for (const props of observed.forecast.filter((frame) => frame.provider === provider)) {
    expect(props.edits).toEqual(emptyEdits);
  }
  for (const props of observed.activity.filter((frame) => frame.provider === provider)) {
    expect(props.prospects).toEqual([]);
    expect(props.classifications).toEqual({});
  }
  for (const props of observed.settings.filter((frame) => frame.provider === provider)) {
    expect(props.teamUserOverrides).toEqual({});
    expect(props.addedTeamUsers).toEqual([]);
    expect(props.notifications).toEqual([]);
  }
  for (const props of observed.actions.filter((frame) => frame.provider === provider)) {
    expect(props.edits).toEqual(emptyEdits);
    expect(props.prospects).toEqual([]);
    expect(props.classifications).toEqual({});
    expect(props.roster).toEqual({ overrides: {}, added: [] });
    expect(props.notifications).toEqual([]);
    expect(props.policy).toEqual(DEFAULT_ACTION_POLICY);
  }
  for (const props of observed.workflow.filter((frame) => frame.provider === provider)) {
    expect(props.records).toEqual([]);
    expect(props.changes).toEqual([]);
    expect(props.target).toBeNull();
    expect(props.roster).toEqual({ overrides: {}, added: [] });
  }
}

async function verifyReset(harness: Harness, id: 'local' | 'remote') {
  const provider = harness.providers[id];
  expect(screen.queryByRole('region', { name: 'Action context' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  for (const route of ['Forecasting', 'Activity Tracking', 'Settings', 'Action Center']) {
    await visit(route);
  }
  // Each inventory surface actually rendered. No empty-loop assertions.
  for (const frames of [
    observed.forecast,
    observed.activity,
    observed.settings,
    observed.actions,
    observed.workflow,
  ]) {
    expect(frames.some((frame) => frame.provider === provider)).toBe(true);
  }
  expectCleanFrames(provider);
  const rows = await provider.listQuarterOpportunities(
    INTERNAL_DEMO_SCOPE,
    { quarter: 'FY27-Q3' },
    { limit: 25 },
  );
  expect(
    rows.data.rows.find((row) => row.id === harness.books[id].opportunities[0].id),
  ).toMatchObject({
    forecastedRevenue: 500_000,
    forecastCategory: 'pipeline',
    nextStep: '',
    notes: `${id.toUpperCase()} source note`,
  });
}

describe('VAL-RES-003 committed-provider session inventory', () => {
  it.each([false, true])(
    'atomically resets the complete inventory both ways and on return (identifier collision: %s)',
    async (collision) => {
      const harness = setup(collision);
      const original = JSON.stringify(harness.books);
      const entityIds = (id: 'local' | 'remote') => {
        const book = harness.books[id];
        return [
          ...book.partnerManagers,
          ...book.partners,
          ...book.opportunities,
          ...book.registrations,
          ...book.activities,
          ...book.teamUsers,
        ].map((entity) => entity.id);
      };
      const sharedIds = entityIds('local').filter((id) => entityIds('remote').includes(id));
      expect(sharedIds).toHaveLength(collision ? entityIds('local').length : 0);
      const initialStorage = [Object.entries(localStorage), Object.entries(sessionStorage)];
      await settle();
      for (const [source, destination] of [
        ['local', 'remote'],
        ['remote', 'local'],
      ] as const) {
        await seedSession(harness, source);
        expectSeeded(harness, source);
        const oldSend = latest(observed.settings).onSendNotification;
        const gate = await request(harness, destination);
        expect(gate.candidate).toBe(harness.providers[destination]);
        expectSeeded(harness, source);
        await act(async () => gate.reject());
        await screen.findByText(/The readiness check failed/);
        expectSeeded(harness, source);
        fireEvent.click(
          screen.getByRole('button', {
            name: `Stay on ${source === 'local' ? 'Local mock' : 'Simulated remote'}`,
          }),
        );
        expect(gate.signal.aborted).toBe(true);
        expect(screen.getByLabelText('Data provider')).toHaveValue(source);
        expectSeeded(harness, source);

        const cancelled = await request(harness, destination);
        change('Data provider', source);
        await act(async () => cancelled.resolve());
        expect(cancelled.signal.aborted).toBe(true);
        expectSeeded(harness, source);

        const failed = await request(harness, destination);
        await act(async () => failed.reject());
        fireEvent.click(
          await screen.findByRole('button', {
            name: `Retry switch to ${destination === 'local' ? 'Local mock' : 'Simulated remote'}`,
          }),
        );
        expect(latest(harness.probes).candidate).toBe(failed.candidate);
        clearTrace();
        await act(async () => latest(harness.probes).resolve());
        await settle();
        await verifyReset(harness, destination);
        // A pre-commit notification callback cannot revive the departed state.
        act(() =>
          oldSend(
            {
              userId: harness.books[source].teamUsers[0].id,
              kind: 'manual',
              subject: 'stale',
              body: 'stale',
              channels: ['email'],
            },
            { provider: harness.providers[source], recipient: harness.books[source].teamUsers[0] },
          ),
        );
        expect(latest(observed.actions).notifications).toEqual([]);
      }
      // Reset-on-return, never a promise to restore earlier provider edits.
      clearTrace();
      await commit(harness, 'remote');
      await verifyReset(harness, 'remote');
      expect(JSON.stringify(harness.books)).toBe(original);
      expect([Object.entries(localStorage), Object.entries(sessionStorage)]).toEqual(
        initialStorage,
      );
    },
    30_000,
  );
});

function groupButton(tag: string, index: number) {
  return screen.getByRole('button', { name: new RegExp(`${tag} Manager ${index}`) });
}

async function selectNondefaults(route: string, namespace: string, tag: string) {
  if (route === 'Partner View') {
    change('Viewing as', `${namespace}-partner-2`);
  } else {
    if (route === 'Forecasting') {
      expect(groupButton(tag, 1)).toHaveAttribute('aria-expanded', 'true');
      expect(groupButton(tag, 2)).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(groupButton(tag, 1));
      fireEvent.click(groupButton(tag, 2));
    }
    change('Partner manager', `${namespace}-manager-2`);
    await settle();
    expect(screen.getByLabelText('Partner manager')).toHaveValue(`${namespace}-manager-2`);
    if (route !== 'Forecasting') change('Partner', `${namespace}-partner-2`);
  }
  await settle();
}

function expectDefaultSelections(route: string, namespace: string, tag: string) {
  if (route === 'Partner View') {
    expect(screen.getByLabelText('Viewing as')).toHaveValue(`${namespace}-partner-1`);
    expect(screen.getByRole('heading', { name: `${tag} Partner 1`, level: 1 })).toBeInTheDocument();
  } else {
    expect(screen.getByLabelText('Partner manager')).toHaveValue(
      route === 'Activity Tracking' ? `${namespace}-manager-1` : 'all',
    );
    if (route === 'Forecasting') {
      expect(groupButton(tag, 1)).toHaveAttribute('aria-expanded', 'true');
      expect(groupButton(tag, 2)).toHaveAttribute('aria-expanded', 'false');
    } else {
      expect(screen.getByLabelText('Partner')).toHaveValue('all');
    }
  }
}

describe('VAL-RES-003 real-view selection defaults', () => {
  it.each([false, true])(
    'context target and unsaved actor/outcome/reason reset on each real-view commit (collision: %s)',
    async (collision) => {
      observed.renderViews = true;
      const harness = setup(collision);
      await settle();
      for (const [source, destination] of [
        ['local', 'remote'],
        ['remote', 'local'],
      ] as const) {
        await visit('Action Center');
        const registration = harness.books[source].registrations[0];
        const row = screen
          .getAllByTestId('action-item')
          .find((item) => item.dataset.actionId === `registration:${registration.id}`)!;
        fireEvent.click(within(row).getByRole('link', { name: 'Open Deal Reg Ops context' }));
        await settle();
        expect(screen.getByRole('region', { name: 'Action context' })).toHaveTextContent(
          registration.id,
        );
        fireEvent.click(screen.getByRole('button', { name: `Decide ${registration.id}` }));
        const actor = await screen.findByLabelText('Demo actor (not authenticated)');
        expect(actor).toHaveValue('');
        expect(
          within(actor)
            .getAllByRole('option')
            .map((option) => option.getAttribute('value')),
        ).toEqual(['', ...harness.books[source].teamUsers.map((user) => user.id)]);
        change('Demo actor (not authenticated)', harness.books[source].teamUsers[0].id);
        change('Outcome', 'approved');
        change('Reason', `${source} unsaved reason`);
        const gate = await request(harness, destination);
        expect(actor).toHaveValue(harness.books[source].teamUsers[0].id);
        await act(async () => gate.reject());
        expect(screen.getByLabelText('Reason')).toHaveValue(`${source} unsaved reason`);
        fireEvent.click(
          screen.getByRole('button', {
            name: `Retry switch to ${destination === 'local' ? 'Local mock' : 'Simulated remote'}`,
          }),
        );
        await act(async () => latest(harness.probes).resolve());
        await settle();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Action context' })).not.toBeInTheDocument();
        fireEvent.click(
          screen.getByRole('button', {
            name: `Decide ${harness.books[destination].registrations[0].id}`,
          }),
        );
        const nextActor = await screen.findByLabelText('Demo actor (not authenticated)');
        expect(nextActor).toHaveValue('');
        expect(screen.getByLabelText('Outcome')).toHaveValue('');
        expect(screen.getByLabelText('Reason')).toHaveValue('');
        expect(
          within(nextActor)
            .getAllByRole('option')
            .map((option) => option.getAttribute('value')),
        ).toEqual(['', ...harness.books[destination].teamUsers.map((user) => user.id)]);
        expect(
          within(nextActor).queryByRole('option', { name: new RegExp(source.toUpperCase()) }),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      }
    },
  );

  it.each(['Partner Performance', 'Activity Tracking', 'Forecasting', 'Partner View'])(
    '%s resets manager/partner/expanded selections in both directions and on return',
    async (route) => {
      observed.renderViews = true;
      const harness = setup();
      await settle();
      await visit(route);
      for (const [source, destination] of [
        ['local', 'remote'],
        ['remote', 'local'],
      ] as const) {
        await selectNondefaults(route, source.toUpperCase(), source.toUpperCase());
        const gate = await request(harness, destination);
        // Pending requests do not remount or reconcile the committed directory.
        if (route === 'Partner View') {
          expect(screen.getByLabelText('Viewing as')).toHaveValue(
            `${source.toUpperCase()}-partner-2`,
          );
        } else {
          expect(screen.getByLabelText('Partner manager')).toHaveValue(
            `${source.toUpperCase()}-manager-2`,
          );
        }
        await act(async () => gate.resolve());
        await settle();
        expectDefaultSelections(route, destination.toUpperCase(), destination.toUpperCase());
        const selector = screen.getByLabelText(
          route === 'Partner View' ? 'Viewing as' : 'Partner manager',
        );
        expect(
          within(selector).queryByRole('option', { name: new RegExp(source.toUpperCase()) }),
        ).not.toBeInTheDocument();
      }
      await commit(harness, 'remote');
      expectDefaultSelections(route, 'REMOTE', 'REMOTE');
    },
  );

  it('same-ID manager and partner selections are reset, not rebound to another provider', async () => {
    observed.renderViews = true;
    const harness = setup(true);
    await settle();
    await visit('Partner Performance');
    await selectNondefaults('Partner Performance', 'shared', 'LOCAL');
    await commit(harness, 'remote');
    expectDefaultSelections('Partner Performance', 'shared', 'REMOTE');
    await visit('Partner View');
    await selectNondefaults('Partner View', 'shared', 'REMOTE');
    await commit(harness, 'local');
    expectDefaultSelections('Partner View', 'shared', 'LOCAL');
  });

  it('clears removed-recipient fences and restarts session IDs without accepting stale saves on return', async () => {
    const harness = setup();
    await settle();
    let staleSend: SettingsProps['onSendNotification'] | undefined;
    let staleRecipient: SettingsProps['addedTeamUsers'][number] | undefined;
    for (const id of ['local', 'remote', 'local'] as const) {
      if (staleSend) await commit(harness, id);
      await visit('Settings');
      act(() =>
        latest(observed.settings).onAddTeamUser({
          name: `${id} reused ID`,
          email: 'reused@example.test',
          role: 'analyst',
          channels: ['email'],
        }),
      );
      expect(latest(observed.settings).addedTeamUsers[0].id).toBe('session-user-1');
      act(() => latest(observed.settings).onSetTeamUserStatus('session-user-1', 'active'));
      const recipient = latest(observed.settings).addedTeamUsers[0];
      const draft = {
        userId: recipient.id,
        kind: 'manual' as const,
        subject: 'fresh',
        body: 'fresh',
        channels: ['email'] as typeof recipient.channels,
      };
      if (staleSend && staleRecipient) {
        act(() =>
          staleSend!(draft, { provider: harness.providers.local, recipient: staleRecipient! }),
        );
        expect(latest(observed.settings).notifications).toEqual([]);
      }
      act(() =>
        latest(observed.settings).onSendNotification(draft, {
          provider: harness.providers[id],
          recipient,
        }),
      );
      expect(latest(observed.settings).notifications).toMatchObject([
        { id: 'notification-1', userId: 'session-user-1' },
      ]);
      staleSend = latest(observed.settings).onSendNotification;
      staleRecipient = recipient;
      act(() => latest(observed.settings).onRemoveTeamUser(recipient.id));
      act(() =>
        latest(observed.settings).onSendNotification(draft, {
          provider: harness.providers[id],
          recipient,
        }),
      );
      expect(latest(observed.settings).notifications).toHaveLength(1);
    }
  });
});
