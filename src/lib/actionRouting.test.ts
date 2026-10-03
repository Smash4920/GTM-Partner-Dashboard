import { describe, expect, it } from 'vitest';
import type { TeamRole, TeamUser, TeamUserStatus } from '../data/types';
import { routeActionOwner } from './actionRouting';

function user(
  id: string,
  role: TeamRole,
  status: TeamUserStatus = 'active',
  partnerManagerId?: string,
): TeamUser {
  return {
    id,
    role,
    status,
    partnerManagerId,
    name: 'Demo teammate',
    email: 'demo@example.test',
    channels: ['email'],
    addedAt: '2026-01-01T00:00:00Z',
  };
}

const ineligible = [
  user('invited-manager', 'partner-manager', 'invited', 'pm-1'),
  user('paused-manager', 'partner-manager', 'suspended', 'pm-1'),
  user('wrong-manager', 'partner-manager', 'active', 'pm-2'),
  user('unaligned-manager', 'partner-manager'),
  user('analyst', 'analyst', 'active', 'pm-1'),
];

describe('action routing recommendations', () => {
  it('routes opportunity and health actions to manager then lead', () => {
    for (const kind of ['opportunity', 'partner'] as const) {
      const managers = [
        user('z-manager', 'partner-manager', 'active', 'pm-1'),
        user('a-manager', 'partner-manager', 'active', 'pm-1'),
      ];
      const leads = [user('z-lead', 'partnership-lead'), user('a-lead', 'partnership-lead')];
      const roster = [...ineligible, ...leads, ...managers, user('desk', 'deal-desk-ops')];
      expect(routeActionOwner(kind, 'pm-1', roster)).toEqual({
        userId: 'a-manager',
        basis: 'manager',
      });
      expect(routeActionOwner(kind, 'pm-1', [...roster].reverse())).toEqual(
        routeActionOwner(kind, 'pm-1', roster),
      );
      expect(routeActionOwner(kind, 'pm-1', [...ineligible, ...leads])).toEqual({
        userId: 'a-lead',
        basis: 'partnership-lead',
      });
      expect(routeActionOwner(kind, undefined, managers)).toEqual({ basis: 'unowned' });
      expect(routeActionOwner(kind, '', [user('blank', 'partner-manager', 'active', '')])).toEqual({
        basis: 'unowned',
      });
      expect(
        routeActionOwner(kind, 'pm-1', [
          ...ineligible,
          user('lead-invited', 'partnership-lead', 'invited'),
          user('lead-paused', 'partnership-lead', 'suspended'),
          user('desk', 'deal-desk-ops'),
        ]),
      ).toEqual({ basis: 'unowned' });
    }
  });

  it('routes registration actions to manager then deal desk', () => {
    const manager = user('manager', 'partner-manager', 'active', 'pm-1');
    const desks = [user('z-desk', 'deal-desk-ops'), user('a-desk', 'deal-desk-ops')];
    const lead = user('lead', 'partnership-lead');
    expect(routeActionOwner('registration', 'pm-1', [...desks, lead, manager])).toEqual({
      userId: 'manager',
      basis: 'manager',
    });
    for (const roster of [
      [...ineligible, lead, ...desks],
      [...desks, lead, ...ineligible],
    ]) {
      expect(routeActionOwner('registration', 'pm-1', roster)).toEqual({
        userId: 'a-desk',
        basis: 'deal-desk',
      });
    }
    expect(routeActionOwner('registration', undefined, desks)).toEqual({
      userId: 'a-desk',
      basis: 'deal-desk',
    });
    expect(
      routeActionOwner('registration', 'pm-1', [
        ...ineligible,
        lead,
        user('desk-invited', 'deal-desk-ops', 'invited'),
        user('desk-paused', 'deal-desk-ops', 'suspended'),
      ]),
    ).toEqual({ basis: 'unowned' });
    expect(routeActionOwner('registration', 'pm-1', [])).toEqual({ basis: 'unowned' });
  });
});
