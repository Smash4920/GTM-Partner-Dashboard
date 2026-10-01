import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActivityTrackingView from './ActivityTrackingView';
import { makeMeeting, makePartner, makeProviderBook } from '../test/fixtures';
import { SNAPSHOT_DATE } from '../data/constants';
import type { DataProvider } from '../data/DataProvider';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { SimulatedRemoteProvider } from '../data/mock/SimulatedRemoteProvider';
import { startOfWeekUtc } from '../lib/fiscal';
import { formatDate } from '../lib/format';
import type { MeetingClassification } from '../data/types';
import type { ProviderBook } from '../data/mock/book';
import { EMPTY_DIRECTORY_COPY } from '../data/useActivityQueries';

/**
 * Activity Tracking over the scoped contract (VAL-DATA-015): the weekly goal
 * counts every call across a partner manager's whole book while the partner
 * dropdown only re-scopes the eight-week chart, classifications reach the
 * page through `onCommitClassifications`, the Log Meetings calendar is a
 * paginated provider query with its own failure and retry, and a failed
 * directory or roster degrades the selectors without blanking the charts.
 * The book is hand-built so an assertion fails because the view broke, not
 * because a seeded volume moved. Meeting times are derived from
 * SNAPSHOT_DATE, so the suite's "this week" moves with the snapshot.
 */

const WEEK_START = startOfWeekUtc(SNAPSHOT_DATE);
const DAY = 86_400_000;

/** An instant `day` days into the snapshot's week, at `hour` UTC. */
function at(day: number, hour: number): string {
  return new Date(WEEK_START.getTime() + day * DAY + hour * 3_600_000).toISOString();
}

function makeBook(): ProviderBook {
  return makeProviderBook({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({ id: 'partner-1', name: 'Northwind Systems', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', name: 'Beacon Consulting', partnerManagerId: 'pm-1' }),
      // On pm-1's roster with no calls at all, so a filter can select nothing.
      makePartner({ id: 'partner-4', name: 'Delta Labs', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-3', name: 'Cobalt Group', partnerManagerId: 'pm-2' }),
    ],
    activities: [
      makeMeeting({
        id: 'meeting-mon',
        partnerId: 'partner-1',
        occurredAt: at(0, 15),
        type: 'discovery',
      }),
      makeMeeting({
        id: 'meeting-tue',
        partnerId: 'partner-2',
        occurredAt: at(1, 9),
        type: 'pio-interlock',
      }),
      // The week before the snapshot week: inside the chart, outside the goal.
      makeMeeting({
        id: 'meeting-prior',
        partnerId: 'partner-1',
        occurredAt: at(-6, 10),
        type: 'deal-support',
      }),
      makeMeeting({
        id: 'meeting-other',
        partnerId: 'partner-3',
        partnerManagerId: 'pm-2',
        occurredAt: at(2, 11),
        type: 'discovery',
      }),
    ],
    registrations: [],
    opportunities: [],
    targets: [],
    certifications: [],
  });
}

function renderView({
  book = makeBook(),
  classifications = {},
  provider,
}: {
  book?: ProviderBook;
  classifications?: Record<string, MeetingClassification>;
  provider?: DataProvider;
} = {}) {
  const handlers = {
    onCommitClassifications: vi.fn(),
    onAddPartner: vi.fn(() => 'partner-new'),
  };
  render(
    <ActivityTrackingView
      provider={provider ?? new MockDataProvider(book)}
      classifications={classifications}
      prospects={[]}
      {...handlers}
    />,
  );
  return handlers;
}

/** The card whose <h2> carries this title, so queries cannot leak across panels. */
function cardWith(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  return heading.closest('section') as HTMLElement;
}

const goalCard = () => cardWith('Progress to weekly goal');
const volumeCard = () => cardWith('Weekly meeting volume');

/** Waits until the view has followed the directory to the first manager. */
async function settleToFirstManager() {
  await within(goalCard()).findByText('2/10');
}

type GatedMethod = 'getManagerDirectory' | 'getWeeklyGoalProgress';

interface GatedCall {
  method: GatedMethod;
  /** The business scope argument the method was called with. */
  scope: unknown;
  release: () => void;
  reject: (reason: unknown) => void;
}

/**
 * A provider whose named methods answer only when the test releases them —
 * the deterministic clock for the frame-by-frame race assertions. A gated
 * call resolves by delegating to the real mock with its original arguments,
 * so every answer is the provider's true figure for its scope.
 */
function gatedProvider(book: ProviderBook, methods: GatedMethod[]) {
  const inner = new MockDataProvider(book);
  const calls: GatedCall[] = [];
  const provider = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property !== 'string' ||
        typeof value !== 'function' ||
        !methods.includes(property as GatedMethod)
      ) {
        return value;
      }
      return (...args: unknown[]) => {
        let release!: () => void;
        let reject!: (reason: unknown) => void;
        const gate = new Promise<void>((res, rej) => {
          release = res;
          reject = rej;
        });
        calls.push({ method: property as GatedMethod, scope: args[1], release, reject });
        return gate.then(() => (value as (...rest: unknown[]) => unknown).apply(target, args));
      };
    },
  }) as DataProvider;
  return { provider, calls };
}

/**
 * Records every committed DOM frame that pairs the resolved manager's name
 * with org-wide figures — the mixed-scope attribution these tests exist to
 * forbid. The fixture's org-wide answers differ from pm-1's: three meetings
 * this week across both managers (two for pm-1), and four meetings across
 * the eight-week chart (three for pm-1).
 */
function watchForMixedFrames() {
  const frames: string[] = [];
  const observer = new MutationObserver(() => {
    const text = document.body.textContent ?? '';
    const managerNamed = text.includes('J. Alvarez');
    const orgWideFigures =
      text.includes('3/10') ||
      text.includes('3 total this week') ||
      text.includes('30% of goal') ||
      text.includes('4 meetings in scope');
    if (managerNamed && orgWideFigures) frames.push(text.slice(0, 400));
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { frames, stop: () => observer.disconnect() };
}

/** The heading block: kicker, h1, and weekly-goal line — no selectors. */
function headerBlock() {
  return screen.getByRole('heading', { name: 'Activity Tracking' }).parentElement as HTMLElement;
}

describe('ActivityTrackingView', () => {
  it("aggregates the weekly goal across the manager's whole book", async () => {
    renderView();

    const weekLabelStart = formatDate(WEEK_START.toISOString());
    const weekLabelEnd = formatDate(new Date(WEEK_START.getTime() + 6 * DAY).toISOString());
    expect(
      await within(goalCard()).findByText(
        `This week ${weekLabelStart} – ${weekLabelEnd} · J. Alvarez`,
      ),
    ).toBeInTheDocument();

    // Two calls inside the snapshot week: one discovery, one PIO interlock.
    await settleToFirstManager();
    expect(within(goalCard()).getByText('20% of goal')).toBeInTheDocument();
    expect(within(goalCard()).getByText('1/3')).toBeInTheDocument();
    expect(within(goalCard()).getByText('33% of goal')).toBeInTheDocument();
    expect(within(goalCard()).getByText('2 total this week')).toBeInTheDocument();
    expect(within(goalCard()).getByText('Discovery')).toBeInTheDocument();
    expect(within(goalCard()).getByText('PIO Interlock')).toBeInTheDocument();

    // The chart spans eight weeks, so the prior-week call is in scope without
    // counting toward this week's goal.
    expect(await within(volumeCard()).findByText('3 meetings in scope')).toBeInTheDocument();
    expect(within(volumeCard()).getByLabelText('2 meetings')).toBeInTheDocument();
    expect(within(volumeCard()).getByLabelText('1 meetings')).toBeInTheDocument();
  });

  it('re-scopes the chart to one partner without shrinking the manager-wide goal', async () => {
    const user = userEvent.setup();
    renderView();
    await settleToFirstManager();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-1');

    expect(await within(volumeCard()).findByText('2 meetings in scope')).toBeInTheDocument();
    // The goal belongs to the manager, not to the partner filter.
    expect(within(goalCard()).getByText('2/10')).toBeInTheDocument();

    // A partner on the roster with no calls is a real, empty scope.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-4');

    expect(await within(volumeCard()).findByText('0 meetings in scope')).toBeInTheDocument();
    expect(within(volumeCard()).getAllByLabelText('0 meetings')).toHaveLength(8);
    expect(within(volumeCard()).queryByLabelText('1 meetings')).not.toBeInTheDocument();
  });

  it('resets the partner filter when the manager changes', async () => {
    const user = userEvent.setup();
    renderView();
    await settleToFirstManager();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner manager' }), 'pm-2');

    expect(screen.getByRole('combobox', { name: 'Partner' })).toHaveValue('all');
    expect(await screen.findByRole('option', { name: 'All Partners (1)' })).toBeInTheDocument();
    await within(goalCard()).findByText(/· R\. Diaz$/);
    expect(await within(volumeCard()).findByText('1 meetings in scope')).toBeInTheDocument();
  });

  it('reflects classifications that were committed before the modal opens', async () => {
    const user = userEvent.setup();
    renderView({
      classifications: {
        // Both of this week's calls re-pointed at partner-2, and the PIO
        // interlock re-typed as deal support.
        'meeting-mon': { partnerId: 'partner-2', type: 'discovery' },
        'meeting-tue': { partnerId: 'partner-2', type: 'deal-support' },
      },
    });

    await within(goalCard()).findByText('0/3');
    expect(within(goalCard()).getByText('0% of goal')).toBeInTheDocument();
    expect(within(goalCard()).getByText('Deal Support')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-2');
    expect(await within(volumeCard()).findByText('2 meetings in scope')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-1');
    expect(await within(volumeCard()).findByText('1 meetings in scope')).toBeInTheDocument();
  });

  it('commits the classifications confirmed in Log Meetings', async () => {
    const user = userEvent.setup();
    const { onCommitClassifications } = renderView({
      classifications: {
        'meeting-mon': { partnerId: 'partner-1', type: 'deal-support' },
      },
    });
    await settleToFirstManager();

    const openButton = screen.getByRole('button', { name: 'Log Meetings' });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });
    expect(within(dialog).getByText('Log meetings · J. Alvarez')).toBeInTheDocument();
    // The committed classification seeds the draft the manager edits, once
    // the calendar's page has landed.
    expect(
      await within(dialog).findByRole('combobox', { name: 'Call type for 15:00 meeting' }),
    ).toHaveValue('deal-support');

    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Call type for 09:00 meeting' }),
      'gtm-enablement',
    );

    // An unsubmitted change makes closing ask first.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCommitClassifications).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Discard unsubmitted classifications?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Log meetings' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Submit classifications' }));

    expect(onCommitClassifications).toHaveBeenCalledWith({
      'meeting-mon': { partnerId: 'partner-1', type: 'deal-support' },
      'meeting-tue': { partnerId: 'partner-2', type: 'gtm-enablement' },
    });
    expect(screen.queryByRole('dialog', { name: 'Log meetings' })).not.toBeInTheDocument();
  });

  it('closes Log Meetings silently when nothing was reclassified', async () => {
    const user = userEvent.setup();
    const { onCommitClassifications } = renderView();
    await settleToFirstManager();

    const openButton = screen.getByRole('button', { name: 'Log Meetings' });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);
    await screen.findByRole('dialog', { name: 'Log meetings' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Log meetings' })).not.toBeInTheDocument();
    expect(onCommitClassifications).not.toHaveBeenCalled();
  });

  it('treats a re-typed call as unsubmitted work even when its partner did not move', async () => {
    const user = userEvent.setup();
    const { onCommitClassifications } = renderView({
      classifications: {
        // Identical to the calendar's own default for this call: recording it
        // still says a manager confirmed it, so editing the type leaves a draft.
        'meeting-tue': { partnerId: 'partner-2', type: 'pio-interlock' },
      },
    });
    await settleToFirstManager();

    const openButton = screen.getByRole('button', { name: 'Log Meetings' });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });
    await user.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Call type for 09:00 meeting' }),
      'gtm-enablement',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(within(dialog).getByText('Discard unsubmitted classifications?')).toBeInTheDocument();
    expect(onCommitClassifications).not.toHaveBeenCalled();
  });

  it('keeps the goal standing when the calendar fails, and retries only the calendar', async () => {
    const user = userEvent.setup();
    renderView({
      provider: new SimulatedRemoteProvider(new MockDataProvider(makeBook()), {
        latencyMs: 0,
        failMethods: { listWeeklyClassificationMeetings: 1 },
      }),
    });
    await settleToFirstManager();

    const openButton = screen.getByRole('button', { name: 'Log Meetings' });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });

    // The calendar page failed inside the modal; the goal card is untouched.
    await within(dialog).findByText('Failed to load the week’s meetings');
    expect(within(goalCard()).getByText('2/10')).toBeInTheDocument();

    // The retry names the failed collection.
    await user.click(within(dialog).getByRole('button', { name: 'Retry meeting calendar' }));

    expect(
      await within(dialog).findByRole('combobox', { name: 'Call type for 15:00 meeting' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText('Failed to load the week’s meetings'),
    ).not.toBeInTheDocument();
  });

  it('degrades the selectors when the directory fails, but keeps the aggregates', async () => {
    const user = userEvent.setup();
    renderView({
      provider: new SimulatedRemoteProvider(new MockDataProvider(makeBook()), {
        latencyMs: 0,
        failMethods: { getManagerDirectory: 1 },
      }),
    });

    // No directory: the header falls back, the manager select is disabled
    // with a retry, and the aggregates answer org-wide (three calls across
    // both managers) rather than going blank.
    const directoryError = await screen.findByText(/Failed to load the manager directory/);
    expect(screen.getByRole('combobox', { name: 'Partner manager' })).toBeDisabled();
    expect(within(goalCard()).getByText('3/10')).toBeInTheDocument();
    const heading = screen.getByRole('heading', { name: 'Activity Tracking' });
    expect(
      within(heading.parentElement as HTMLElement).getByText('Partner manager'),
    ).toBeInTheDocument();

    // Retrying the directory alone restores the selection.
    await user.click(
      within(directoryError.closest('p') as HTMLElement).getByRole('button', { name: 'Retry' }),
    );
    await settleToFirstManager();
    expect(screen.getByRole('combobox', { name: 'Partner manager' })).toBeEnabled();
  });

  it('degrades the partner selector when the roster fails, but keeps the goal', async () => {
    const user = userEvent.setup();
    renderView({
      provider: new SimulatedRemoteProvider(new MockDataProvider(makeBook()), {
        latencyMs: 0,
        failMethods: { getPartnerRoster: 1 },
      }),
    });

    await settleToFirstManager();
    const rosterError = screen.getByText(/Failed to load the partner roster/);
    expect(screen.getByRole('combobox', { name: 'Partner' })).toBeDisabled();
    // Without a roster the calendar cannot label its partner selects.
    expect(screen.getByRole('button', { name: 'Log Meetings' })).toBeDisabled();

    await user.click(
      within(rosterError.closest('p') as HTMLElement).getByRole('button', { name: 'Retry' }),
    );
    expect(await screen.findByRole('option', { name: 'All Partners (3)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Partner' })).toBeEnabled();
  });

  it('registers a prospect from the partner dropdown', async () => {
    const user = userEvent.setup();
    const { onAddPartner } = renderView();
    await settleToFirstManager();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), '__add_partner__');
    const form = screen.getByRole('dialog', { name: 'Add prospective partner' });
    expect(within(form).getByText('New prospective partner · J. Alvarez')).toBeInTheDocument();

    const input = within(form).getByPlaceholderText('Partner name');
    expect(within(form).getByRole('button', { name: 'Add' })).toBeDisabled();
    // Enter without a name is not a submission, and neither is a click on the
    // disabled Add button.
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onAddPartner).not.toHaveBeenCalled();

    // The typed name is trimmed before it reaches the book.
    await user.type(input, '  Delta Labs  ');
    await user.click(within(form).getByRole('button', { name: 'Add' }));

    expect(onAddPartner).toHaveBeenCalledWith('Delta Labs', 'pm-1');
    expect(
      screen.queryByRole('dialog', { name: 'Add prospective partner' }),
    ).not.toBeInTheDocument();
  });

  it('abandons the prospect form on Escape and on Cancel', async () => {
    const user = userEvent.setup();
    const { onAddPartner } = renderView();
    await settleToFirstManager();
    const partnerSelect = screen.getByRole('combobox', { name: 'Partner' });

    await user.selectOptions(partnerSelect, '__add_partner__');
    await user.click(screen.getByPlaceholderText('Partner name'));
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Add prospective partner' }),
    ).not.toBeInTheDocument();

    await user.selectOptions(partnerSelect, '__add_partner__');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('dialog', { name: 'Add prospective partner' }),
    ).not.toBeInTheDocument();

    expect(onAddPartner).not.toHaveBeenCalled();
  });

  it('registers a prospect from inside Log Meetings and drafts it onto the call', async () => {
    const user = userEvent.setup();
    const { onAddPartner, onCommitClassifications } = renderView();
    await settleToFirstManager();

    const openButton = screen.getByRole('button', { name: 'Log Meetings' });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });

    await user.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Partner for 15:00 meeting' }),
      '__add_partner__',
    );
    const form = within(dialog).getByRole('dialog', { name: 'Add prospective partner' });
    await user.type(within(form).getByPlaceholderText('Partner name'), 'Delta Labs');
    await user.keyboard('{Enter}');

    expect(onAddPartner).toHaveBeenCalledWith('Delta Labs', 'pm-1');

    // The prospect is drafted onto the meeting, so submitting records it even
    // though the roster it came from does not hold it yet.
    await user.click(within(dialog).getByRole('button', { name: 'Submit classifications' }));
    expect(onCommitClassifications).toHaveBeenCalledWith({
      'meeting-mon': { partnerId: 'partner-new', type: 'discovery' },
    });
  });

  it('backs out of the inline prospect form inside Log Meetings', async () => {
    const user = userEvent.setup();
    const { onAddPartner } = renderView();
    await settleToFirstManager();

    const openButton = screen.getByRole('button', { name: 'Log Meetings' });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });
    const partnerFor = await within(dialog).findByRole('combobox', {
      name: 'Partner for 15:00 meeting',
    });

    await user.selectOptions(partnerFor, '__add_partner__');
    const form = within(dialog).getByRole('dialog', { name: 'Add prospective partner' });
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));

    expect(
      within(dialog).queryByRole('dialog', { name: 'Add prospective partner' }),
    ).not.toBeInTheDocument();
    expect(onAddPartner).not.toHaveBeenCalled();
    expect(partnerFor).toHaveValue('partner-1');
  });

  it('reports an answered-empty directory explicitly instead of rendering org-wide zeroes', async () => {
    const user = userEvent.setup();
    const inner = new MockDataProvider(
      makeProviderBook({
        partnerManagers: [],
        partners: [],
        activities: [],
        registrations: [],
        opportunities: [],
        targets: [],
        certifications: [],
      }),
    );
    // Record every provider call: the whole point is the requests the view
    // must NOT issue once the directory has answered with nobody on it.
    const calls: string[] = [];
    const provider = new Proxy(inner, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof property !== 'string' || typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(property);
          return (value as (...rest: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as DataProvider;
    renderView({ provider });

    // The generic header and the (empty) roster still answer; neither is
    // manager-attributed.
    const heading = screen.getByRole('heading', { name: 'Activity Tracking' });
    expect(
      within(heading.parentElement as HTMLElement).getByText('Partner manager'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'All Partners (0)' })).toBeInTheDocument();

    // The goal surfaces name the truthful state. Org-wide zero bars would
    // attribute the crowd's work to a manager nobody has — so no goal or
    // series request was ever issued, and the cards say why.
    expect(await within(goalCard()).findByText('Weekly goal unavailable:')).toBeInTheDocument();
    expect(within(goalCard()).getByText('Weekly meeting types unavailable:')).toBeInTheDocument();
    // Both goal widgets and the volume card carry the same truthful reason.
    expect(within(goalCard()).getAllByText(EMPTY_DIRECTORY_COPY)).toHaveLength(2);
    expect(within(goalCard()).queryByText('0/10')).not.toBeInTheDocument();
    expect(within(volumeCard()).getByText('Weekly activity unavailable:')).toBeInTheDocument();
    expect(within(volumeCard()).getByText(EMPTY_DIRECTORY_COPY)).toBeInTheDocument();
    expect(calls).not.toContain('getWeeklyGoalProgress');
    expect(calls).not.toContain('getWeeklyActivitySeries');
    expect(calls).not.toContain('listWeeklyClassificationMeetings');

    // Retrying the goal card re-asks the directory — the only answer that
    // can change this state.
    await user.click(screen.getByRole('button', { name: 'Retry weekly goal' }));
    await waitFor(() =>
      expect(calls.filter((method) => method === 'getManagerDirectory')).toHaveLength(2),
    );
    expect(calls).not.toContain('getWeeklyGoalProgress');

    // Nobody to log against, so the calendar never opens.
    expect(screen.getByRole('button', { name: 'Log Meetings' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Log Meetings' }));
    expect(screen.queryByRole('dialog', { name: 'Log meetings' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), '__add_partner__');
    expect(screen.getByText('New prospective partner · this manager')).toBeInTheDocument();
  });

  it('never renders a resolved manager’s label over org-wide goal figures', async () => {
    const { provider, calls } = gatedProvider(makeBook(), [
      'getManagerDirectory',
      'getWeeklyGoalProgress',
    ]);
    const trace = watchForMixedFrames();
    renderView({ provider });

    // While the directory is still answering there is no resolved manager,
    // so the goal query is not issued at all: no org-wide placeholder can
    // end up attributed to whoever the directory is about to name.
    expect(calls.filter((call) => call.method === 'getWeeklyGoalProgress')).toHaveLength(0);
    expect(within(goalCard()).getByText('Loading weekly goal')).toBeInTheDocument();
    expect(within(goalCard()).queryByText('3/10')).not.toBeInTheDocument();
    expect(within(headerBlock()).getByText('Partner manager')).toBeInTheDocument();

    // The directory lands: the label commits, and the only goal request in
    // flight already carries the resolved manager's scope.
    await act(async () => {
      calls.find((call) => call.method === 'getManagerDirectory')!.release();
    });
    await within(goalCard()).findByText(/· J\. Alvarez/);
    const goalCalls = calls.filter((call) => call.method === 'getWeeklyGoalProgress');
    expect(goalCalls).toHaveLength(1);
    expect(goalCalls[0]!.scope).toMatchObject({ partnerManagerId: 'pm-1' });
    // Its answer is still in flight: the manager's name stands over a
    // loading state, never over figures another scope produced.
    expect(within(goalCard()).getByText('Loading weekly goal')).toBeInTheDocument();
    expect(within(goalCard()).queryByText('3/10')).not.toBeInTheDocument();

    await act(async () => {
      goalCalls[0]!.release();
    });
    await within(goalCard()).findByText('2/10');
    expect(within(goalCard()).getByText('2 total this week')).toBeInTheDocument();

    await act(async () => {}); // flush the observer's microtasks
    trace.stop();
    expect(trace.frames).toEqual([]);
  });

  it('keeps the org-wide fallback truthful on directory failure and commits the recovered manager under one scope', async () => {
    const user = userEvent.setup();
    const { provider, calls } = gatedProvider(makeBook(), [
      'getManagerDirectory',
      'getWeeklyGoalProgress',
    ]);
    const trace = watchForMixedFrames();
    renderView({ provider });

    // The directory's first attempt fails: the documented org-wide fallback.
    await act(async () => {
      calls.find((call) => call.method === 'getManagerDirectory')!.reject(new Error('down'));
    });
    const directoryError = await screen.findByText(/Failed to load the manager directory/);

    // The fallback is explicit and truthful: org-wide figures under the
    // generic label, with the failure named beside the disabled selector.
    const fallbackGoal = calls.filter((call) => call.method === 'getWeeklyGoalProgress');
    expect(fallbackGoal).toHaveLength(1);
    expect(fallbackGoal[0]!.scope).toMatchObject({ partnerManagerId: undefined });
    await act(async () => {
      fallbackGoal[0]!.release();
    });
    await within(goalCard()).findByText('3/10');
    expect(within(goalCard()).getByText('3 total this week')).toBeInTheDocument();
    expect(within(headerBlock()).getByText('Partner manager')).toBeInTheDocument();
    expect(screen.queryByText('J. Alvarez')).not.toBeInTheDocument();

    // Retrying the directory succeeds: the resolved manager's label and the
    // goal figures commit under one scope identity — the org-wide answer is
    // never shown under the manager's name, not even for one frame.
    await user.click(
      within(directoryError.closest('p') as HTMLElement).getByRole('button', { name: 'Retry' }),
    );
    await act(async () => {
      calls.filter((call) => call.method === 'getManagerDirectory')[1]!.release();
    });
    await within(goalCard()).findByText(/· J\. Alvarez/);
    // The org-wide answer left the screen in the same commit that named the
    // manager; the manager's own answer is still in flight.
    expect(within(goalCard()).queryByText('3/10')).not.toBeInTheDocument();
    expect(within(goalCard()).getByText('Loading weekly goal')).toBeInTheDocument();
    const recoveredGoal = calls.filter((call) => call.method === 'getWeeklyGoalProgress');
    expect(recoveredGoal).toHaveLength(2);
    expect(recoveredGoal[1]!.scope).toMatchObject({ partnerManagerId: 'pm-1' });

    await act(async () => {
      recoveredGoal[1]!.release();
    });
    await within(goalCard()).findByText('2/10');
    expect(screen.getByRole('combobox', { name: 'Partner manager' })).toBeEnabled();

    await act(async () => {}); // flush the observer's microtasks
    trace.stop();
    expect(trace.frames).toEqual([]);
  });
});
