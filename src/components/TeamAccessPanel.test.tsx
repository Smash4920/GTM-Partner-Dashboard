import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamAccessPanel from './TeamAccessPanel';
import { makeTeamUser } from '../test/fixtures';
import { TEAM_ROLE_META } from '../data/constants';
import type { PartnerManager, TeamUser } from '../data/types';

/**
 * Partner-team notification roster: the roster summary, the add-user form's
 * validation branches, and the single row action each routing state offers.
 *
 * The panel's whole point is that being on the roster and receiving simulated
 * notifications are two different states — an add lands with routing off — so
 * most of these tests assert on the exact argument handed to a callback rather
 * than on appearance. Manager names are deliberately unrelated to the fixture
 * user names: a row's accessible name is its full text, so a collision would
 * make row queries ambiguous.
 */

/** User, Role, Aligned manager, Channels, Added, Notifications, Action. */
const ALIGNED_MANAGER_COLUMN = 2;
const NOTIFICATIONS_COLUMN = 5;

const MANAGERS: PartnerManager[] = [
  { id: 'pm-1', name: 'A. Director' },
  { id: 'pm-2', name: 'B. Nguyen' },
];

function renderPanel(
  options: {
    users?: TeamUser[];
    partnerManagers?: PartnerManager[];
    addedUserIds?: string[];
  } = {},
) {
  const handlers = { onAdd: vi.fn(), onSetStatus: vi.fn(), onRemove: vi.fn() };
  render(
    <TeamAccessPanel
      users={options.users ?? [makeTeamUser()]}
      partnerManagers={options.partnerManagers ?? MANAGERS}
      addedUserIds={new Set(options.addedUserIds ?? [])}
      {...handlers}
    />,
  );
  return handlers;
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add user' }));
  return screen.getByRole('dialog', { name: 'Add internal user' });
}

function dialog() {
  return screen.getByRole('dialog', { name: 'Add internal user' });
}

describe('TeamAccessPanel roster', () => {
  it('labels every control a session-only notification-routing simulation (VAL-GOV-003)', () => {
    renderPanel();

    expect(
      screen.getByText(/Current-session notification-routing simulation only/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Refresh resets the roster/)).toBeInTheDocument();

    // No control or result may claim to provision, authorize, revoke, or
    // restore sign-in or data access.
    expect(screen.queryByRole('button', { name: /authorize/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting authorization/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/access revoked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^authorized$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/authorized to sign in|grant(s|ed)? (sign-in|access)|can sign in/i),
    ).not.toBeInTheDocument();
  });

  it('counts routing-on and not-yet-routing users separately from the roster size', () => {
    renderPanel({
      users: [
        makeTeamUser({ id: 'user-1', status: 'active' }),
        makeTeamUser({ id: 'user-2', email: 'second@example.com', status: 'invited' }),
        makeTeamUser({ id: 'user-3', email: 'third@example.com', status: 'suspended' }),
        makeTeamUser({ id: 'user-4', email: 'fourth@example.com', status: 'invited' }),
      ],
    });

    // A paused user is neither receiving notifications nor waiting for routing
    // setup, which is why the two numbers do not simply add up to the roster size.
    expect(
      screen.getByText(/4 on the roster · 1 receiving notifications · 2 not yet\s+routing/),
    ).toBeInTheDocument();
  });

  it('flips the toggle label, aria-expanded, and form visibility', async () => {
    const user = userEvent.setup();
    renderPanel();

    const toggle = screen.getByRole('button', { name: 'Add user' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Add internal user' })).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'Add user' })).not.toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    // The form names the simulation boundary: a new entry does not receive
    // notifications until routing is turned on, and nothing is authorized.
    expect(
      within(dialog()).getByText('Add to the notification roster · routing starts off'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('button', { name: 'Add user' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('dialog', { name: 'Add internal user' })).not.toBeInTheDocument();
  });

  it('renders the user, role, alignment, channels, dates, and access state', () => {
    renderPanel({
      users: [
        makeTeamUser({
          id: 'user-1',
          name: 'J. Alvarez',
          email: 'j.alvarez@example.com',
          role: 'partner-manager',
          partnerManagerId: 'pm-2',
          channels: ['email', 'in-app'],
          addedAt: '2026-02-02T00:00:00.000Z',
          authorizedAt: '2026-02-03T00:00:00.000Z',
        }),
      ],
    });

    const cells = within(screen.getByRole('row', { name: /J\. Alvarez/ })).getAllByRole('cell');

    expect(within(cells[0]).getByText('J. Alvarez')).toBeInTheDocument();
    expect(within(cells[0]).getByText('j.alvarez@example.com')).toBeInTheDocument();
    expect(cells[1]).toHaveTextContent('Partner Manager');
    expect(cells[1]).toHaveTextContent(TEAM_ROLE_META['partner-manager'].description);
    expect(cells[ALIGNED_MANAGER_COLUMN]).toHaveTextContent('B. Nguyen');
    expect(within(cells[3]).getByText('Email')).toBeInTheDocument();
    expect(within(cells[3]).getByText('In-app')).toBeInTheDocument();
    expect(within(cells[3]).queryByText('Slack')).not.toBeInTheDocument();
    expect(cells[4]).toHaveTextContent('Feb 2, 2026');
    expect(cells[NOTIFICATIONS_COLUMN]).toHaveTextContent('Notifications on');
    expect(
      within(cells[NOTIFICATIONS_COLUMN]).getByText('routing since Feb 3, 2026'),
    ).toBeInTheDocument();
  });

  it('shows an em dash for a role that is not aligned to one manager', () => {
    renderPanel({
      users: [
        makeTeamUser({
          id: 'user-1',
          name: 'A. Analyst',
          role: 'analyst',
          partnerManagerId: 'pm-1',
          authorizedAt: undefined,
        }),
      ],
    });

    const cells = within(screen.getByRole('row', { name: /A\. Analyst/ })).getAllByRole('cell');

    // The id is set but the role ignores it: alignment is a property of the
    // role, and an analyst owns no registrations.
    expect(cells[ALIGNED_MANAGER_COLUMN]).toHaveTextContent('—');
    expect(
      within(cells[NOTIFICATIONS_COLUMN]).queryByText(/^routing since /),
    ).not.toBeInTheDocument();
  });

  it('shows an em dash when the aligned manager is not on the roster', () => {
    renderPanel({
      users: [makeTeamUser({ id: 'user-1', name: 'T. Manager', partnerManagerId: 'pm-gone' })],
    });

    const cells = within(screen.getByRole('row', { name: /T\. Manager/ })).getAllByRole('cell');
    expect(cells[ALIGNED_MANAGER_COLUMN]).toHaveTextContent('—');
  });

  it('marks only session-added users with the "Added this session" note', () => {
    renderPanel({
      users: [
        makeTeamUser({ id: 'user-1', name: 'J. Alvarez' }),
        makeTeamUser({ id: 'user-2', name: 'P. Iyer', email: 'p.iyer@example.com' }),
      ],
      addedUserIds: ['user-2'],
    });

    expect(screen.getAllByText('Added this session')).toHaveLength(1);
    expect(
      within(screen.getByRole('row', { name: /P\. Iyer/ })).getByText('Added this session'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /J\. Alvarez/ })).queryByText('Added this session'),
    ).not.toBeInTheDocument();
  });
});

describe('TeamAccessPanel row actions', () => {
  it('offers Pause notifications to a user with routing on', async () => {
    const user = userEvent.setup();
    const { onSetStatus, onRemove } = renderPanel({
      users: [makeTeamUser({ id: 'user-1', status: 'active' })],
    });

    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume notifications' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pause notifications' }));

    expect(onSetStatus).toHaveBeenCalledWith('user-1', 'suspended');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('offers Turn on notifications to a user whose routing is not set up', async () => {
    const user = userEvent.setup();
    const { onSetStatus } = renderPanel({
      users: [makeTeamUser({ id: 'user-1', status: 'invited' })],
    });

    expect(screen.queryByRole('button', { name: 'Pause notifications' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Turn on notifications' }));

    expect(onSetStatus).toHaveBeenCalledWith('user-1', 'active');
  });

  it('offers Resume notifications to a paused user', async () => {
    const user = userEvent.setup();
    const { onSetStatus } = renderPanel({
      users: [makeTeamUser({ id: 'user-1', status: 'suspended' })],
    });

    expect(screen.queryByRole('button', { name: 'Pause notifications' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume notifications' }));

    expect(onSetStatus).toHaveBeenCalledWith('user-1', 'active');
  });

  it('offers Remove only to users added this session', async () => {
    const user = userEvent.setup();
    const { onRemove, onSetStatus } = renderPanel({
      users: [
        makeTeamUser({ id: 'user-1', status: 'invited' }),
        makeTeamUser({
          id: 'user-2',
          name: 'P. Iyer',
          email: 'p.iyer@example.com',
          status: 'active',
        }),
      ],
      addedUserIds: ['user-2'],
    });

    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(
      within(screen.getByRole('row', { name: /P\. Iyer/ })).getByRole('button', { name: 'Remove' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onRemove).toHaveBeenCalledWith('user-2');
    // Removing is not a status change; the two callbacks stay separate.
    expect(onSetStatus).not.toHaveBeenCalled();
  });
});

describe('AddTeamUserForm', () => {
  it('links every invalid field to its error and focuses the first invalid field (VAL-A11Y-004)', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel({ partnerManagers: [] });
    await openForm(user);

    await user.click(screen.getByRole('button', { name: 'Add to roster' }));

    for (const [label, message] of [
      ['Name', 'A name is required.'],
      ['Work email', 'Enter a valid work email address.'],
      ['Aligned manager', 'A partner manager needs an aligned partner manager.'],
    ]) {
      const field = screen.getByLabelText(label);
      const error = screen.getByText(message);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAttribute('aria-describedby', error.id);
      expect(error.id).not.toBe('');
      expect(error).toBeVisible();
    }
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('clears corrected field errors and disabled manager associations', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel({ partnerManagers: [] });
    await openForm(user);
    await user.click(screen.getByRole('button', { name: 'Add to roster' }));
    await user.type(screen.getByLabelText('Name'), 'Riley Chen');
    await user.type(screen.getByLabelText('Work email'), 'riley@example.com');
    await user.selectOptions(screen.getByLabelText('Role'), 'analyst');

    for (const label of ['Name', 'Work email', 'Aligned manager']) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute('aria-invalid');
      expect(screen.getByLabelText(label)).not.toHaveAttribute('aria-describedby');
    }
    expect(screen.getByLabelText('Aligned manager')).toBeDisabled();
    expect(screen.queryByText('A name is required.')).not.toBeInTheDocument();
    expect(screen.queryByText('Enter a valid work email address.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('A partner manager needs an aligned partner manager.'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add to roster' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('links duplicate email errors and moves focus to email until corrected', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel({ users: [makeTeamUser({ email: 'riley@example.com' })] });
    await openForm(user);
    await user.type(screen.getByLabelText('Name'), 'Riley Chen');
    const email = screen.getByLabelText('Work email');
    await user.type(email, 'RILEY@example.com');
    await user.click(screen.getByRole('button', { name: 'Add to roster' }));

    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('That email is already on the roster.');
    expect(onAdd).not.toHaveBeenCalled();
    await user.clear(email);
    await user.type(email, 'new@example.com');
    expect(email).not.toHaveAttribute('aria-describedby');
    expect(email).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('That email is already on the roster.')).not.toBeInTheDocument();
  });

  it('focuses the aligned manager when it is the only invalid field', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel({ partnerManagers: [] });
    await openForm(user);
    await user.type(screen.getByLabelText('Name'), 'Riley Chen');
    await user.type(screen.getByLabelText('Work email'), 'riley@example.com');
    await user.click(screen.getByRole('button', { name: 'Add to roster' }));
    expect(screen.getByLabelText('Aligned manager')).toHaveFocus();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('uses a native noValidate form and submits once on Enter from name', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const form = await openForm(user);
    expect(form.tagName).toBe('FORM');
    expect(form).toHaveAttribute('novalidate');
    await user.type(screen.getByLabelText('Work email'), 'riley@example.com');
    await user.type(screen.getByLabelText('Name'), 'Riley Chen{Enter}');
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it.each(['Name', 'Role', 'Aligned manager'])(
    'cancels safely on Escape from %s',
    async (label) => {
      const user = userEvent.setup();
      const { onAdd } = renderPanel();
      await openForm(user);
      screen.getByLabelText(label).focus();
      await user.keyboard('{Escape}');
      expect(onAdd).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Add internal user' })).not.toBeInTheDocument();
    },
  );

  it('requires a name', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    await openForm(user);

    await user.click(screen.getByRole('button', { name: 'Add to roster' }));

    expect(screen.getByText('A name is required.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only name as missing', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    await openForm(user);

    await user.type(screen.getByLabelText('Name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Add to roster' }));

    expect(screen.getByText('A name is required.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('rejects an address that is not a work email', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    await openForm(user);

    await user.type(screen.getByLabelText('Name'), 'Riley Chen');
    await user.type(screen.getByLabelText('Work email'), 'riley@factory');
    await user.click(screen.getByRole('button', { name: 'Add to roster' }));

    expect(screen.getByText('Enter a valid work email address.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('rejects an email already on the roster regardless of case', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel({
      users: [makeTeamUser({ id: 'user-1', email: 'j.alvarez@example.com' })],
    });
    await openForm(user);

    await user.type(screen.getByLabelText('Name'), 'J. Alvarez');
    await user.type(screen.getByLabelText('Work email'), 'J.Alvarez@Example.com');
    await user.click(screen.getByRole('button', { name: 'Add to roster' }));

    expect(screen.getByText('That email is already on the roster.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('requires an aligned manager for the partner-manager role', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel({ partnerManagers: [] });
    const form = await openForm(user);

    // With no managers to pick from, the id stays empty — the state in which a
    // registration would have no owner to alert.
    const manager = within(form).getByLabelText('Aligned manager');
    expect(within(manager).queryAllByRole('option')).toHaveLength(0);

    await user.type(within(form).getByLabelText('Name'), 'Tess Okafor');
    await user.type(within(form).getByLabelText('Work email'), 'tess.okafor@example.com');
    await user.click(within(form).getByRole('button', { name: 'Add to roster' }));

    expect(
      screen.getByText('A partner manager needs an aligned partner manager.'),
    ).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('trims the name and email and keeps the chosen manager and channels', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const form = await openForm(user);

    await user.type(within(form).getByLabelText('Name'), '  Riley Chen  ');
    await user.type(within(form).getByLabelText('Work email'), '  Riley.Chen@Example.com  ');
    await user.selectOptions(within(form).getByLabelText('Aligned manager'), 'pm-2');
    await user.click(within(form).getByRole('button', { name: 'Add to roster' }));

    expect(onAdd).toHaveBeenCalledWith({
      name: 'Riley Chen',
      email: 'riley.chen@example.com',
      role: 'partner-manager',
      partnerManagerId: 'pm-2',
      channels: ['email', 'slack', 'in-app'],
    });
    // The panel takes over closing the form once the add is handed off.
    expect(screen.queryByRole('dialog', { name: 'Add internal user' })).not.toBeInTheDocument();
  });

  it('omits the manager for a role that is not aligned to one', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const form = await openForm(user);

    await user.type(within(form).getByLabelText('Name'), 'Sam Reyes');
    await user.type(within(form).getByLabelText('Work email'), 'sam.reyes@example.com');
    await user.selectOptions(within(form).getByLabelText('Role'), 'analyst');

    expect(within(form).getByText(/Read-only reporting across the ecosystem/)).toBeInTheDocument();
    expect(within(form).queryByText(/Without an alignment/)).not.toBeInTheDocument();

    await user.click(within(form).getByRole('button', { name: 'Add to roster' }));

    expect(onAdd).toHaveBeenCalledWith({
      name: 'Sam Reyes',
      email: 'sam.reyes@example.com',
      role: 'analyst',
      partnerManagerId: undefined,
      channels: ['email', 'slack', 'in-app'],
    });
  });

  it('disables the aligned manager select for a role that is not aligned', async () => {
    const user = userEvent.setup();
    renderPanel();
    const form = await openForm(user);

    expect(within(form).getByLabelText('Aligned manager')).toBeEnabled();

    await user.selectOptions(within(form).getByLabelText('Role'), 'partnership-lead');

    expect(within(form).getByLabelText('Role')).toHaveValue('partnership-lead');
    expect(within(form).getByLabelText('Aligned manager')).toBeDisabled();
  });

  it('toggles optional channels and submits the resulting set', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const form = await openForm(user);

    const slack = within(form).getByRole('button', { name: 'Slack' });
    expect(slack).toHaveAttribute('aria-pressed', 'true');

    await user.click(slack);
    expect(slack).toHaveAttribute('aria-pressed', 'false');

    await user.click(slack);
    expect(slack).toHaveAttribute('aria-pressed', 'true');

    await user.click(slack);
    await user.type(within(form).getByLabelText('Name'), 'Ada Lin');
    await user.type(within(form).getByLabelText('Work email'), 'ada.lin@example.com');
    await user.click(within(form).getByRole('button', { name: 'Add to roster' }));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ channels: ['email', 'in-app'] }));
  });

  it('keeps email on because it is the channel that reaches everyone', async () => {
    const user = userEvent.setup();
    renderPanel();
    const form = await openForm(user);

    const email = within(form).getByRole('button', { name: 'Email' });
    expect(email).toBeDisabled();
    expect(email).toHaveAttribute('aria-pressed', 'true');

    // userEvent refuses to click a disabled control, so the click is dispatched
    // directly: the handler itself must also refuse to turn email off.
    fireEvent.click(email);

    expect(email).toHaveAttribute('aria-pressed', 'true');
  });

  it('submits on Enter from the email field', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const form = await openForm(user);

    await user.type(within(form).getByLabelText('Name'), 'Ada Lin');
    await user.type(within(form).getByLabelText('Work email'), 'ada.lin@example.com{Enter}');

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Add internal user' })).not.toBeInTheDocument();
  });

  it('cancels on Escape from the email field', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const form = await openForm(user);

    await user.type(within(form).getByLabelText('Name'), 'Ada Lin');
    await user.type(within(form).getByLabelText('Work email'), 'ada.lin@example.com{Escape}');

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Add internal user' })).not.toBeInTheDocument();
  });

  it('closes from Cancel without adding anyone', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const form = await openForm(user);

    await user.type(within(form).getByLabelText('Name'), 'Ada Lin');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Add internal user' })).not.toBeInTheDocument();
  });
});
