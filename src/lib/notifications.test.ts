import { describe, expect, it } from 'vitest';
import type { DealRegistration, Partner } from '../data/types';
import type { RegistrationSlaAlert } from './metrics';
import { composeCopy, registrationNoteCopy, slaAlertCopy } from './notifications';

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
