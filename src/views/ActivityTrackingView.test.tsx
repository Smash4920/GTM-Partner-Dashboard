import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActivityTrackingView from './ActivityTrackingView';
import { makeDashboardData, makeMeeting, makePartner } from '../test/fixtures';
import { SNAPSHOT_DATE } from '../data/constants';
import { startOfWeekUtc } from '../lib/fiscal';
import { formatDate } from '../lib/format';
import type { DashboardData, MeetingClassification } from '../data/types';

/**
 * Activity Tracking: the weekly goal counts every call across a partner
 * manager's whole book while the partner dropdown only re-scopes the eight-week
 * chart, classifications reach the page through `onCommitClassifications`, and
 * the inline Add Partner form validates before it hands a prospect to
 * `onAddPartner`. The book is hand-built so an assertion fails because the view
 * broke, not because a seeded volume moved. Meeting times are derived from
 * SNAPSHOT_DATE, so the suite's "this week" moves with the snapshot.
 */

const WEEK_START = startOfWeekUtc(SNAPSHOT_DATE);
const DAY = 86_400_000;

/** An instant `day` days into the snapshot's week, at `hour` UTC. */
function at(day: number, hour: number): string {
  return new Date(WEEK_START.getTime() + day * DAY + hour * 3_600_000).toISOString();
}

function makeBook(overrides: Partial<DashboardData> = {}): DashboardData {
  return makeDashboardData({
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
    ...overrides,
  });
}

function renderView(
  data: DashboardData = makeBook(),
  classifications: Record<string, MeetingClassification> = {},
) {
  const handlers = {
    onCommitClassifications: vi.fn(),
    onAddPartner: vi.fn(() => 'partner-new'),
  };
  render(<ActivityTrackingView data={data} classifications={classifications} {...handlers} />);
  return handlers;
}

/** The card whose <h2> carries this title, so queries cannot leak across panels. */
function cardWith(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  return heading.closest('section') as HTMLElement;
}

const goalCard = () => cardWith('Progress to weekly goal');
const volumeCard = () => cardWith('Weekly meeting volume');

describe('ActivityTrackingView', () => {
  it("aggregates the weekly goal across the manager's whole book", () => {
    renderView();

    const weekLabelStart = formatDate(WEEK_START.toISOString());
    const weekLabelEnd = formatDate(new Date(WEEK_START.getTime() + 6 * DAY).toISOString());
    expect(
      within(goalCard()).getByText(`This week ${weekLabelStart} – ${weekLabelEnd} · J. Alvarez`),
    ).toBeInTheDocument();

    // Two calls inside the snapshot week: one discovery, one PIO interlock.
    expect(within(goalCard()).getByText('2/10')).toBeInTheDocument();
    expect(within(goalCard()).getByText('20% of goal')).toBeInTheDocument();
    expect(within(goalCard()).getByText('1/3')).toBeInTheDocument();
    expect(within(goalCard()).getByText('33% of goal')).toBeInTheDocument();
    expect(within(goalCard()).getByText('2 total this week')).toBeInTheDocument();
    expect(within(goalCard()).getByText('Discovery')).toBeInTheDocument();
    expect(within(goalCard()).getByText('PIO Interlock')).toBeInTheDocument();

    // The chart spans eight weeks, so the prior-week call is in scope without
    // counting toward this week's goal.
    expect(within(volumeCard()).getByText('3 meetings in scope')).toBeInTheDocument();
    expect(within(volumeCard()).getByLabelText('2 meetings')).toBeInTheDocument();
    expect(within(volumeCard()).getByLabelText('1 meetings')).toBeInTheDocument();
  });

  it('re-scopes the chart to one partner without shrinking the manager-wide goal', async () => {
    const user = userEvent.setup();
    renderView();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-1');

    expect(within(volumeCard()).getByText('2 meetings in scope')).toBeInTheDocument();
    // The goal belongs to the manager, not to the partner filter.
    expect(within(goalCard()).getByText('2/10')).toBeInTheDocument();

    // A partner on the roster with no calls is a real, empty scope.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-4');

    expect(within(volumeCard()).getByText('0 meetings in scope')).toBeInTheDocument();
    expect(within(volumeCard()).getAllByLabelText('0 meetings')).toHaveLength(8);
    expect(within(volumeCard()).queryByLabelText('1 meetings')).not.toBeInTheDocument();
  });

  it('resets the partner filter when the manager changes', async () => {
    const user = userEvent.setup();
    renderView();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner manager' }), 'pm-2');

    expect(screen.getByRole('combobox', { name: 'Partner' })).toHaveValue('all');
    expect(screen.getByRole('option', { name: 'All Partners (1)' })).toBeInTheDocument();
    expect(within(goalCard()).getByText(/· R\. Diaz$/)).toBeInTheDocument();
    expect(within(volumeCard()).getByText('1 meetings in scope')).toBeInTheDocument();
  });

  it('reflects classifications that were committed before the modal opens', async () => {
    const user = userEvent.setup();
    renderView(makeBook(), {
      // Both of this week's calls re-pointed at partner-2, and the PIO
      // interlock re-typed as deal support.
      'meeting-mon': { partnerId: 'partner-2', type: 'discovery' },
      'meeting-tue': { partnerId: 'partner-2', type: 'deal-support' },
    });

    expect(within(goalCard()).getByText('0/3')).toBeInTheDocument();
    expect(within(goalCard()).getByText('0% of goal')).toBeInTheDocument();
    expect(within(goalCard()).getByText('Deal Support')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-2');
    expect(within(volumeCard()).getByText('2 meetings in scope')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-1');
    expect(within(volumeCard()).getByText('1 meetings in scope')).toBeInTheDocument();
  });

  it('commits the classifications confirmed in Log Meetings', async () => {
    const user = userEvent.setup();
    const { onCommitClassifications } = renderView(makeBook(), {
      'meeting-mon': { partnerId: 'partner-1', type: 'deal-support' },
    });

    await user.click(screen.getByRole('button', { name: 'Log Meetings' }));
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });
    expect(within(dialog).getByText('Log meetings · J. Alvarez')).toBeInTheDocument();
    // The committed classification seeds the draft the manager edits.
    expect(
      within(dialog).getByRole('combobox', { name: 'Call type for 15:00 meeting' }),
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

    await user.click(screen.getByRole('button', { name: 'Log Meetings' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Log meetings' })).not.toBeInTheDocument();
    expect(onCommitClassifications).not.toHaveBeenCalled();
  });

  it('treats a re-typed call as unsubmitted work even when its partner did not move', async () => {
    const user = userEvent.setup();
    const { onCommitClassifications } = renderView(makeBook(), {
      // Identical to the calendar's own default for this call: recording it
      // still says a manager confirmed it, so editing the type leaves a draft.
      'meeting-tue': { partnerId: 'partner-2', type: 'pio-interlock' },
    });

    await user.click(screen.getByRole('button', { name: 'Log Meetings' }));
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Call type for 09:00 meeting' }),
      'gtm-enablement',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(within(dialog).getByText('Discard unsubmitted classifications?')).toBeInTheDocument();
    expect(onCommitClassifications).not.toHaveBeenCalled();
  });

  it('registers a prospect from the partner dropdown', async () => {
    const user = userEvent.setup();
    const { onAddPartner } = renderView();

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

    await user.click(screen.getByRole('button', { name: 'Log Meetings' }));
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });

    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Partner for 15:00 meeting' }),
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

    await user.click(screen.getByRole('button', { name: 'Log Meetings' }));
    const dialog = screen.getByRole('dialog', { name: 'Log meetings' });
    const partnerFor = within(dialog).getByRole('combobox', { name: 'Partner for 15:00 meeting' });

    await user.selectOptions(partnerFor, '__add_partner__');
    const form = within(dialog).getByRole('dialog', { name: 'Add prospective partner' });
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));

    expect(
      within(dialog).queryByRole('dialog', { name: 'Add prospective partner' }),
    ).not.toBeInTheDocument();
    expect(onAddPartner).not.toHaveBeenCalled();
    expect(partnerFor).toHaveValue('partner-1');
  });

  it('falls back to unnamed copy when the book carries no partner managers', async () => {
    const user = userEvent.setup();
    renderView(makeBook({ partnerManagers: [], partners: [], activities: [] }));

    const heading = screen.getByRole('heading', { name: 'Activity Tracking' });
    expect(
      within(heading.parentElement as HTMLElement).getByText('Partner manager'),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All Partners (0)' })).toBeInTheDocument();
    // Both progress bars — meetings and PIO interlocks — sit at zero.
    expect(within(goalCard()).getAllByText('0% of goal')).toHaveLength(2);
    expect(screen.getByText(/under the selected manager/)).toBeInTheDocument();

    // Nobody to log against, so the calendar never opens.
    await user.click(screen.getByRole('button', { name: 'Log Meetings' }));
    expect(screen.queryByRole('dialog', { name: 'Log meetings' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), '__add_partner__');
    expect(screen.getByText('New prospective partner · this manager')).toBeInTheDocument();
  });
});
