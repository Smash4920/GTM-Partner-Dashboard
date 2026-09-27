import type {
  ActivityMeeting,
  DashboardData,
  DashboardNotification,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerCertification,
  ProviderBook,
  Target,
  TeamUser,
} from '../data/types';

/**
 * Hand-built records for component tests.
 *
 * Deliberately not the seeded generator: a component test should fail because
 * the component broke, not because a volume constant moved. `src/lib`'s suites
 * take the same approach.
 */

export function makePartner(overrides: Partial<Partner> = {}): Partner {
  return {
    id: 'partner-1',
    name: 'Northwind Systems',
    type: 'reseller',
    tier: 'gold',
    region: 'na',
    accountManager: 'A. Director',
    partnerManagerId: 'pm-1',
    joinedAt: '2024-02-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    partnerId: 'partner-1',
    accountName: 'Acme Freight',
    factoryAccountDirector: 'R. Okonkwo',
    oppType: 'sell-with',
    stage: 'scope',
    forecastedRevenue: 250_000,
    createdAt: '2026-08-03T00:00:00.000Z',
    expectedCloseDate: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

export function makeMeeting(overrides: Partial<ActivityMeeting> = {}): ActivityMeeting {
  return {
    id: 'meeting-1',
    partnerId: 'partner-1',
    partnerManagerId: 'pm-1',
    type: 'discovery',
    // The Monday of the snapshot week, so it lands in the modal's grid.
    occurredAt: '2026-09-14T15:00:00.000Z',
    durationMinutes: 30,
    ...overrides,
  };
}

export function makeCertification(
  overrides: Partial<PartnerCertification> = {},
): PartnerCertification {
  return {
    partnerId: 'partner-1',
    partnerStrategistsCertified: 2,
    partnerStrategistsGoal: 4,
    partnerEngineersCertified: 3,
    partnerEngineersGoal: 6,
    ...overrides,
  };
}

export function makeRegistration(overrides: Partial<DealRegistration> = {}): DealRegistration {
  return {
    id: 'reg-1',
    partnerId: 'partner-1',
    accountName: 'Acme Freight',
    amount: 180_000,
    submittedAt: '2026-09-14T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  };
}

export function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    partnerId: 'partner-1',
    quarter: 'FY27-Q3',
    revenueTarget: 500_000,
    ...overrides,
  };
}

export function makeTeamUser(overrides: Partial<TeamUser> = {}): TeamUser {
  return {
    id: 'user-1',
    name: 'J. Alvarez',
    email: 'j.alvarez@example.com',
    role: 'partner-manager',
    partnerManagerId: 'pm-1',
    status: 'active',
    channels: ['email', 'slack'],
    addedAt: '2026-02-02T00:00:00.000Z',
    authorizedAt: '2026-02-03T00:00:00.000Z',
    ...overrides,
  };
}

export function makeNotification(
  overrides: Partial<DashboardNotification> = {},
): DashboardNotification {
  return {
    id: 'notification-1',
    userId: 'user-1',
    kind: 'manual',
    subject: 'Registration needs a response',
    body: 'Acme Freight has been pending since Monday.',
    channels: ['email'],
    sentAt: '2026-09-18T12:00:00.000Z',
    status: 'delivered',
    ...overrides,
  };
}

/** A whole book as the client receives it, small enough to reason about. */
export function makeDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    partnerManagers: [{ id: 'pm-1', name: 'J. Alvarez' }],
    partners: [makePartner()],
    registrations: [makeRegistration()],
    opportunities: [makeOpportunity()],
    targets: [makeTarget()],
    activities: [makeMeeting()],
    certifications: [makeCertification()],
    teamUsers: [],
    ...overrides,
  };
}

/**
 * The same book as a provider holds it: the client shape plus the weekly
 * history that never crosses the seam whole.
 */
export function makeProviderBook(overrides: Partial<ProviderBook> = {}): ProviderBook {
  return { ...makeDashboardData(), snapshots: [], ...overrides };
}
