import { describe, expect, it, vi } from 'vitest';
import type { ActionItem, DealRegistration, Partner, TeamUser } from '../data/types';
import { ACTION_CATEGORIES, ACTION_CATEGORY_LABELS } from '../data/actionCenter';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import { DEFAULT_ACTION_POLICY } from './actionPolicy';
import type { RegistrationSlaAlert } from './metrics';
import {
  actionNotificationDraft,
  composeCopy,
  prepareNotificationDraft,
  registrationNoteCopy,
  slaAlertCopy,
} from './notifications';
import { recordNotification } from './notificationRecords';

const partner: Partner = {
  id: 'p-01',
  name: 'Northwind Solutions',
  type: 'reseller',
  tier: 'gold',
  region: 'na',
  accountManager: 'Dana Reyes',
  partnerManagerId: 'pm-01',
  joinedAt: '2024-01-01T00:00:00Z',
};

const registration: DealRegistration = {
  id: 'reg-0001',
  partnerId: 'p-01',
  accountName: 'Borealis Pharma Group',
  amount: 120_000,
  submittedAt: '2026-09-14T00:00:00Z',
  status: 'pending',
};

function alert(overrides: Partial<RegistrationSlaAlert>): RegistrationSlaAlert {
  return {
    registration,
    partner,
    businessDaysWaiting: 4,
    businessDaysRemaining: 1,
    state: 'approaching',
    dueAt: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('slaAlertCopy', () => {
  it('reads as a deadline about to pass, naming the account and the due date', () => {
    const copy = slaAlertCopy(alert({}));
    expect(copy.kind).toBe('registration-sla-warning');
    expect(copy.subject).toContain('Borealis Pharma Group');
    expect(copy.subject).toContain('next business day');
    expect(copy.body).toContain('Northwind Solutions');
    expect(copy.body).toContain('Sep 21, 2026');
    expect(copy.body).toContain('1 business day left');
  });

  it('counts the overdue business days once the SLA has lapsed', () => {
    const copy = slaAlertCopy(
      alert({ state: 'breached', businessDaysWaiting: 9, businessDaysRemaining: -4 }),
    );
    expect(copy.kind).toBe('registration-sla-breach');
    expect(copy.subject).toContain('lapsed');
    expect(copy.body).toContain('4 business days past');
  });
});

describe('registrationNoteCopy', () => {
  it('asks the owner about a registration still inside the SLA', () => {
    const copy = registrationNoteCopy(registration, partner);
    expect(copy.subject).toContain('Borealis Pharma Group');
    expect(copy.body).toContain('Northwind Solutions');
    expect(copy.body).toContain('4 business days');
  });
});

describe('composeCopy', () => {
  it('uses the alert copy when the registration is on the clock', () => {
    expect(composeCopy({ template: 'sla-alert', registration, partner, alert: alert({}) })).toEqual(
      slaAlertCopy(alert({})),
    );
  });

  it('falls back to the follow-up when the registration is inside the SLA', () => {
    const copy = composeCopy({ template: 'sla-alert', registration, partner });
    expect(copy.kind).toBe('manual');
    expect(copy.subject).toContain('Question on the Borealis Pharma Group registration');
  });

  it('leaves a custom note blank for the sender to write', () => {
    expect(composeCopy({ template: 'custom', registration, partner })).toEqual({
      kind: 'manual',
      subject: '',
      body: '',
    });
  });
});

describe('generalized local notifications', () => {
  async function fixtures() {
    const provider = new MockDataProvider();
    const users = (await provider.getTeamRoster(INTERNAL_DEMO_SCOPE, {})).data;
    const items: ActionItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await provider.listActionItems(
        INTERNAL_DEMO_SCOPE,
        { policy: DEFAULT_ACTION_POLICY },
        { cursor },
      );
      items.push(...page.data.rows);
      cursor = page.data.nextCursor ?? undefined;
    } while (cursor);
    return { users, items };
  }

  it('prefills every category with allowlisted evidence, recommendation, entity and active owner', async () => {
    const { users, items } = await fixtures();
    for (const category of ACTION_CATEGORIES) {
      const item = items.find((candidate) =>
        candidate.reasons.some((reason) => reason.category === category),
      )!;
      const draft = actionNotificationDraft(item, category, users)!;
      expect(draft.subject).toContain(ACTION_CATEGORY_LABELS[category]);
      expect(draft.subject).toContain(item.entityId);
      expect(draft.body).toContain(item.id);
      expect(draft.body).toContain('Evidence:');
      expect(draft.body).toContain(
        item.reasons.find((reason) => reason.category === category)!.recommendedAction,
      );
      expect(draft.userId).toBe(item.owner!.userId);
      expect(users.find((user) => user.id === draft.userId)?.status).toBe('active');
      expect(draft).toMatchObject({
        actionId: item.id,
        actionCategory: category,
        entityKind: item.entityKind,
        entityId: item.entityId,
      });
      expect(Object.keys(draft).sort()).toEqual(
        [
          'userId',
          'kind',
          'subject',
          'body',
          'channels',
          'actionId',
          'actionCategory',
          'entityKind',
          'entityId',
          ...(item.entityKind === 'registration' ? ['registrationId'] : []),
        ].sort(),
      );
    }
  });

  it('excludes inactive and missing owners and absent category reasons', async () => {
    const { users, items } = await fixtures();
    const item = items[0];
    const category = item.reasons[0].category;
    expect(
      actionNotificationDraft({ ...item, owner: { basis: 'unowned' } }, category, users),
    ).toBeNull();
    expect(actionNotificationDraft(item, category, [])).toBeNull();
    for (const status of ['invited', 'suspended'] as const) {
      expect(
        actionNotificationDraft(
          item,
          category,
          users.map((user) => ({ ...user, status })),
        ),
      ).toBeNull();
    }
    expect(actionNotificationDraft({ ...item, reasons: [] }, category, users)).toBeNull();
    expect(actionNotificationDraft({ ...item, owner: undefined }, category, users)).toBeNull();
  });

  it('preserves precise warning and breach evidence and action metadata without copying arbitrary fields', async () => {
    const { users, items } = await fixtures();
    const registrations = items.filter((item) => item.entityKind === 'registration');
    for (const state of ['warning', 'breach'] as const) {
      const item = registrations.find((candidate) =>
        candidate.reasons.some(
          (reason) => reason.category === 'registration-sla' && reason.evidence.state === state,
        ),
      )!;
      const reason = item.reasons[0];
      if (reason.category !== 'registration-sla') throw new Error('Invalid fixture');
      const draft = actionNotificationDraft(item, 'registration-sla', users)!;
      expect(draft.kind).toBe(`registration-sla-${state}`);
      expect(draft.body).toContain(`${reason.evidence.businessDaysWaiting} business days`);
      expect(draft.body).toContain(
        `${reason.evidence.businessDaysRemaining} business days remaining`,
      );
      const unsafeInput = { ...draft, rawRecord: 'sentinel', status: 'delivered' };
      const saved = recordNotification(unsafeInput, 'notification-1', '2026-10-01T12:34:56.000Z');
      expect(saved).toMatchObject({
        ...draft,
        registrationId: item.entityId,
        status: 'simulated-local',
        actionId: item.id,
        entityKind: 'registration',
        actionCategory: 'registration-sla',
      });
      expect(saved).not.toHaveProperty('rawRecord');
      saved.channels.pop();
      expect(draft.channels).toEqual(users.find((user) => user.id === draft.userId)!.channels);
    }
  });

  it('saves only selected configured channels and allowlisted fields using injected action time without transport', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const recipient: TeamUser = {
      id: 'u-1',
      name: 'Demo',
      email: 'demo@example.test',
      role: 'analyst',
      status: 'active',
      channels: ['email', 'in-app'],
      addedAt: '2026-01-01T00:00:00Z',
    };
    const input = {
      userId: 'u-1',
      kind: 'manual' as const,
      subject: ' Subject ',
      body: ' Body ',
      channels: ['slack', 'in-app', 'in-app'] as TeamUser['channels'],
      secret: 'must-not-copy',
    };
    const draft = prepareNotificationDraft(input, recipient)!;
    const record = recordNotification(draft, 'notification-1', '2026-10-01T12:34:56.000Z');
    expect(record).toEqual({
      id: 'notification-1',
      userId: 'u-1',
      kind: 'manual',
      subject: 'Subject',
      body: 'Body',
      channels: ['in-app'],
      sentAt: '2026-10-01T12:34:56.000Z',
      status: 'simulated-local',
    });
    expect(prepareNotificationDraft({ ...input, channels: ['slack'] }, recipient)).toBeNull();
    expect(prepareNotificationDraft({ ...input, subject: ' ' }, recipient)).toBeNull();
    expect(prepareNotificationDraft({ ...input, body: ' ' }, recipient)).toBeNull();
    expect(prepareNotificationDraft(input, { ...recipient, status: 'suspended' })).toBeNull();
    expect(prepareNotificationDraft(input, { ...recipient, id: 'other' })).toBeNull();
    expect(recordNotification(draft, 'notification-2', '2026-10-02T12:34:56.000Z').sentAt).not.toBe(
      record.sentAt,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
