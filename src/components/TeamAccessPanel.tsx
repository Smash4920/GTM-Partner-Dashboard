import { useState, type ReactNode } from 'react';
import {
  NOTIFICATION_CHANNEL_META,
  NOTIFICATION_CHANNELS,
  TEAM_ROLES,
  TEAM_ROLE_META,
  TEAM_USER_STATUS_META,
} from '../data/constants';
import type {
  NewTeamUserInput,
  NotificationChannel,
  PartnerManager,
  TeamRole,
  TeamUser,
  TeamUserStatus,
} from '../data/types';
import { formatDate } from '../lib/format';
import { CheckIcon, PlusIcon, XIcon } from './icons';

/**
 * Partner-team access: who is on the internal roster, whether they are
 * authorized, and which manager they are aligned to.
 *
 * Adding and authorizing are deliberately two steps. Adding puts a name on the
 * roster awaiting authorization; authorizing grants access. That split is what
 * a real identity provider enforces, and it is the difference between "we know
 * who should have access" and "they can sign in" — the gap the architecture
 * roadmap's first item closes.
 */

interface TeamAccessPanelProps {
  users: TeamUser[];
  partnerManagers: PartnerManager[];
  /** Users added during this session, which are the only removable ones. */
  addedUserIds: Set<string>;
  onAdd: (input: NewTeamUserInput) => void;
  onSetStatus: (userId: string, status: TeamUserStatus) => void;
  onRemove: (userId: string) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function TeamAccessPanel({
  users,
  partnerManagers,
  addedUserIds,
  onAdd,
  onSetStatus,
  onRemove,
}: TeamAccessPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const managerName = (id?: string) =>
    partnerManagers.find((manager) => manager.id === id)?.name ?? '—';
  const active = users.filter((user) => user.status === 'active').length;
  const awaiting = users.filter((user) => user.status === 'invited').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-granite">
          {users.length} on the roster · {active} authorized · {awaiting} awaiting authorization
        </p>
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="flex items-center gap-1.5 rounded border border-ash px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-bone transition-colors hover:bg-ash/30"
          aria-expanded={formOpen}
        >
          {formOpen ? <XIcon className="h-3.5 w-3.5" /> : <PlusIcon className="h-3.5 w-3.5" />}
          {formOpen ? 'Close' : 'Add user'}
        </button>
      </div>

      {formOpen && (
        <AddTeamUserForm
          users={users}
          partnerManagers={partnerManagers}
          onAdd={(input) => {
            onAdd(input);
            setFormOpen(false);
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-carbon">
              <Th className="pr-3 text-left">User</Th>
              <Th className="pr-3 text-left">Role</Th>
              <Th className="pr-3 text-left">Aligned manager</Th>
              <Th className="pr-3 text-left">Channels</Th>
              <Th className="pr-3 text-left">Added</Th>
              <Th className="pr-3 text-left">Access</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const status = TEAM_USER_STATUS_META[user.status];
              return (
                <tr key={user.id} className="border-b border-carbon last:border-0">
                  <td className="py-2.5 pr-3">
                    <p className="text-bone">{user.name}</p>
                    <p className="font-mono text-[10px] text-granite">{user.email}</p>
                    {addedUserIds.has(user.id) && (
                      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-stone">
                        Added this session
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <p className="text-stone">{TEAM_ROLE_META[user.role].label}</p>
                    <p className="max-w-[220px] text-[10px] leading-snug text-granite">
                      {TEAM_ROLE_META[user.role].description}
                    </p>
                  </td>
                  <td className="py-2.5 pr-3 text-granite">
                    {user.role === 'partner-manager' ? managerName(user.partnerManagerId) : '—'}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {user.channels.map((channel) => (
                        <span
                          key={channel}
                          className="rounded border border-ash/50 px-1 font-mono text-[9px] uppercase tracking-[0.06em] text-granite"
                        >
                          {NOTIFICATION_CHANNEL_META[channel].label}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs tabular-nums text-granite">
                    {formatDate(user.addedAt)}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
                      <span className={`font-mono text-[10px] uppercase tracking-[0.06em] ${status.textClass}`}>
                        {status.label}
                      </span>
                    </span>
                    {user.authorizedAt && (
                      <p className="mt-0.5 font-mono text-[9px] text-granite">
                        authorized {formatDate(user.authorizedAt)}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      {user.status === 'active' && (
                        <RowAction onClick={() => onSetStatus(user.id, 'suspended')}>
                          Revoke access
                        </RowAction>
                      )}
                      {user.status === 'invited' && (
                        <RowAction onClick={() => onSetStatus(user.id, 'active')}>
                          <CheckIcon className="h-3 w-3" />
                          Authorize
                        </RowAction>
                      )}
                      {user.status === 'suspended' && (
                        <RowAction onClick={() => onSetStatus(user.id, 'active')}>Restore</RowAction>
                      )}
                      {addedUserIds.has(user.id) && (
                        <RowAction onClick={() => onRemove(user.id)}>Remove</RowAction>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className }: { children: ReactNode; className: string }) {
  return (
    <th
      className={`pb-2 font-mono text-[10px] uppercase tracking-[0.06em] text-granite ${className}`}
    >
      {children}
    </th>
  );
}

function RowAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-ash/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/30 hover:text-bone"
    >
      {children}
    </button>
  );
}

interface AddTeamUserFormProps {
  users: TeamUser[];
  partnerManagers: PartnerManager[];
  onAdd: (input: NewTeamUserInput) => void;
  onCancel: () => void;
}

function AddTeamUserForm({ users, partnerManagers, onAdd, onCancel }: AddTeamUserFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('partner-manager');
  const [partnerManagerId, setPartnerManagerId] = useState(partnerManagers[0]?.id ?? '');
  const [channels, setChannels] = useState<NotificationChannel[]>(['email', 'slack', 'in-app']);
  const [error, setError] = useState<string | null>(null);

  const aligned = TEAM_ROLE_META[role].aligned;

  const toggleChannel = (channel: NotificationChannel) => {
    // Email is the channel that reaches everyone, so it is not optional.
    if (channel === 'email') return;
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((item) => item !== channel) : [...prev, channel],
    );
  };

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedName) return setError('A name is required.');
    if (!EMAIL_PATTERN.test(trimmedEmail)) return setError('Enter a valid work email address.');
    if (users.some((user) => user.email.toLowerCase() === trimmedEmail)) {
      return setError('That email is already on the roster.');
    }
    if (aligned && !partnerManagerId) {
      return setError('A partner manager needs an aligned partner manager.');
    }
    onAdd({
      name: trimmedName,
      email: trimmedEmail,
      role,
      partnerManagerId: aligned ? partnerManagerId : undefined,
      channels,
    });
  };

  return (
    <div
      className="rounded border border-ash bg-carbon p-4"
      role="dialog"
      aria-label="Add internal user"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
        Add to the partner team · access awaits authorization
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jordan Fields"
            className={inputClass}
          />
        </Field>
        <Field label="Work email">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') onCancel();
            }}
            placeholder="jordan.fields@factory.ai"
            className={inputClass}
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as TeamRole)}
            className={inputClass}
          >
            {TEAM_ROLES.map((option) => (
              <option key={option} value={option}>
                {TEAM_ROLE_META[option].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Aligned manager">
          <select
            value={partnerManagerId}
            onChange={(event) => setPartnerManagerId(event.target.value)}
            disabled={!aligned}
            className={`${inputClass} disabled:opacity-40`}
          >
            {partnerManagers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="mt-3 text-[10px] leading-snug text-granite">
        {TEAM_ROLE_META[role].description}
        {aligned && ' Without an alignment, none of their registrations would have an owner to alert.'}
      </p>

      <div className="mt-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
          Notification channels
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {NOTIFICATION_CHANNELS.map((channel) => {
            const on = channels.includes(channel);
            return (
              <button
                key={channel}
                type="button"
                onClick={() => toggleChannel(channel)}
                disabled={channel === 'email'}
                aria-pressed={on}
                title={NOTIFICATION_CHANNEL_META[channel].description}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors ${
                  on ? 'border-ash bg-ash/30 text-bone' : 'border-carbon text-granite'
                } ${channel === 'email' ? 'cursor-default' : 'hover:border-ash'}`}
              >
                {on && <CheckIcon className="h-3 w-3" />}
                {NOTIFICATION_CHANNEL_META[channel].label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-signal">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="flex items-center gap-1.5 rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-bone transition-colors hover:bg-ash/30"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add to roster
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-granite transition-colors hover:text-stone"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

const inputClass =
  'w-full rounded border border-ash bg-canvas px-3 py-1.5 text-sm text-bone placeholder:text-graphite focus:border-signal focus:outline-none';
