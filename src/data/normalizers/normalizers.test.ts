import { describe, expect, it } from 'vitest';

import { normalizeCalendarEvent } from './calendar';
import { normalizeCertificationsExport } from './certifications';
import { normalizeCrmExport } from './crm';
import { normalizeEnablementExport } from './enablement';
import {
  calendarEvents,
  certificationRows,
  crmExport,
  enablementRows,
  KNOWN_PARTNER_MANAGER_IDS,
  prmRegistrations,
  targetRows,
} from './fixtures';
import { normalizePrmRegistrations } from './prm';
import { normalizeTargetsExport } from './targets';

/**
 * VAL-DATA-005: the representative source adapters are pure, strict, and
 * provenance-preserving. Each suite pins the happy path for its source
 * system and the typed failures for malformed ids, foreign keys, enums,
 * dates, and money — and, just as importantly, that no failure is healed
 * into a guessed default: an unknown enum never becomes the first enum, a
 * bad date never becomes today, a missing amount never becomes zero.
 */

const KNOWN_PARTNERS: ReadonlySet<string> = new Set(['northwind', 'contoso']);
const KNOWN_OPPORTUNITIES: ReadonlySet<string> = new Set(['opp-1001', 'opp-1002']);
const CALENDAR_CONTEXT = {
  knownPartnerIds: KNOWN_PARTNERS,
  knownPartnerManagerIds: KNOWN_PARTNER_MANAGER_IDS,
};

/** Freeze the input before and after: a pure adapter never mutates it. */
function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

describe('normalizeCrmExport', () => {
  const context = { knownPartnerManagerIds: KNOWN_PARTNER_MANAGER_IDS };

  it('normalizes accounts and opportunities with provenance', () => {
    const before = snapshot(crmExport);
    const result = normalizeCrmExport(crmExport, context);
    expect(snapshot(crmExport)).toBe(before);
    expect(result.issues).toEqual([]);
    expect(result.partners.map((partner) => partner.record.id)).toEqual(['northwind', 'contoso']);
    expect(result.partners[0]!.record).toMatchObject({
      id: 'northwind',
      type: 'reseller',
      tier: 'gold',
      region: 'na',
      accountManager: 'Kai Rocha',
      partnerManagerId: 'pm-ana',
      joinedAt: '2025-02-10T09:00:00.000Z',
    });
    expect(result.partners[0]!.record.prospect).toBeUndefined();
    expect(result.partners[1]!.record.prospect).toBe(true);
    expect(result.opportunities.map((opportunity) => opportunity.record.id)).toEqual([
      'opp-1001',
      'opp-1002',
    ]);
    expect(result.opportunities[0]!.record).toMatchObject({
      partnerId: 'northwind',
      accountName: 'Acme Corp',
      oppType: 'sell-with',
      stage: 'vendor-of-choice',
      forecastedRevenue: 240_000,
      forecastCategory: 'commit',
      registrationId: 'reg-501',
      expectedCloseDate: '2026-03-15T00:00:00.000Z',
    });
    expect(result.opportunities[1]!.record).toMatchObject({
      closedAt: '2026-01-28T16:00:00.000Z',
      outcome: 'won',
    });
    expect(result.opportunities[0]!.provenance).toMatchObject({
      source: 'crm',
      sourceRecordId: 'opp-1001',
    });
    expect(result.opportunities[0]!.provenance.fields).toContain('Forecasted_Revenue__c');
    expect(result.partners[0]!.provenance).toMatchObject({
      source: 'crm',
      sourceRecordId: 'northwind',
    });
  });

  it('is deterministic: the same export normalizes to identical output', () => {
    expect(normalizeCrmExport(crmExport, context)).toEqual(normalizeCrmExport(crmExport, context));
  });

  it('rejects an unknown stage instead of guessing one', () => {
    const result = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Stage_Name__c: 'Verbal Yes' }],
      },
      context,
    );
    expect(result.opportunities).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-enum-value',
        path: 'opportunities[0].Stage_Name__c',
      }),
    ]);
  });

  it('rejects an opportunity whose account the export does not carry', () => {
    const result = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Account_Id__c: 'acme-labs' }],
      },
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-foreign-key',
        path: 'opportunities[0].Account_Id__c',
      }),
    ]);
  });

  it('rejects an account whose partner manager is unknown', () => {
    const result = normalizeCrmExport(
      {
        accounts: [{ ...crmExport.accounts[0]!, Partner_Manager__c: 'pm-nobody' }],
        opportunities: [],
      },
      context,
    );
    expect(result.partners).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-foreign-key',
        path: 'accounts[0].Partner_Manager__c',
      }),
    ]);
  });

  it('rejects a malformed close date instead of defaulting to today', () => {
    const result = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Expected_Close_Date__c: '03/15/2026' }],
      },
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-date',
        path: 'opportunities[0].Expected_Close_Date__c',
      }),
    ]);
  });

  it('rejects an impossible calendar day instead of rolling it over', () => {
    const result = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Expected_Close_Date__c: '2026-02-30' }],
      },
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-date',
        path: 'opportunities[0].Expected_Close_Date__c',
      }),
    ]);
  });

  it('rejects a negative amount instead of clamping it to zero', () => {
    const result = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Forecasted_Revenue__c: -1 }],
      },
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-money',
        path: 'opportunities[0].Forecasted_Revenue__c',
      }),
    ]);
  });

  it('rejects a missing amount instead of defaulting it to zero', () => {
    const result = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Forecasted_Revenue__c: null }],
      },
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'missing-field',
        path: 'opportunities[0].Forecasted_Revenue__c',
      }),
    ]);
  });

  it('accepts a zero amount instead of treating it as missing', () => {
    const result = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Forecasted_Revenue__c: 0 }],
      },
      context,
    );
    expect(result.issues).toEqual([]);
    expect(result.opportunities[0]!.record.forecastedRevenue).toBe(0);
  });

  it('rejects a malformed record id instead of minting one', () => {
    const result = normalizeCrmExport(
      { accounts: crmExport.accounts, opportunities: [{ ...crmExport.opportunities[0]!, Id: '' }] },
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-identifier', path: 'opportunities[0].Id' }),
    ]);
  });

  it('rejects an outcome with no close date, and a close date with no outcome', () => {
    const noClose = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Outcome__c: 'Won' }],
      },
      context,
    );
    expect(noClose.issues).toEqual([
      expect.objectContaining({ code: 'inconsistent-state', path: 'opportunities[0].Outcome__c' }),
    ]);
    const noOutcome = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [{ ...crmExport.opportunities[0]!, Closed_Date__c: '2026-01-28T16:00:00Z' }],
      },
      context,
    );
    expect(noOutcome.issues).toEqual([
      expect.objectContaining({ code: 'inconsistent-state', path: 'opportunities[0].Outcome__c' }),
    ]);
  });

  it.each([
    ['Forecast_Category__c', 'Maybe', 'unknown-enum-value'],
    ['Forecast_Category__c', 42, 'unknown-enum-value'],
    ['Deal_Registration_Id__c', 17, 'invalid-identifier'],
    ['Deal_Registration_Id__c', 'not a slug!!', 'invalid-identifier'],
    ['Closed_Date__c', 'yesterday', 'invalid-date'],
    ['Outcome__c', 'Maybe', 'unknown-enum-value'],
  ])(
    'rejects the whole row when the present optional field %s is malformed',
    (field, value, code) => {
      const result = normalizeCrmExport(
        {
          accounts: crmExport.accounts,
          opportunities: [{ ...crmExport.opportunities[0]!, [field]: value }],
        },
        context,
      );
      // The row is out, not partially normalized: a record missing a field
      // the source DID send is not a clean record, and exactly one issue
      // names the field that killed it — no invented follow-on failures.
      expect(result.opportunities).toEqual([]);
      expect(result.issues).toEqual([
        expect.objectContaining({ code, path: `opportunities[0].${field}` }),
      ]);
    },
  );

  it('keeps absent optional fields a legitimate "not set"', () => {
    const result = normalizeCrmExport(
      {
        accounts: crmExport.accounts,
        opportunities: [
          {
            ...crmExport.opportunities[0]!,
            Forecast_Category__c: null,
            Deal_Registration_Id__c: null,
            Closed_Date__c: null,
            Outcome__c: null,
          },
        ],
      },
      context,
    );
    expect(result.issues).toEqual([]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]!.record.forecastCategory).toBeUndefined();
    expect(result.opportunities[0]!.record.closedAt).toBeUndefined();
  });

  it('rejects duplicate account ids deterministically', () => {
    const result = normalizeCrmExport(
      {
        accounts: [
          crmExport.accounts[0]!,
          { ...crmExport.accounts[1]!, Id: 'northwind', Name: 'Northwind Copy' },
        ],
        opportunities: [],
      },
      context,
    );
    expect(result.partners.map((partner) => partner.record.name)).toEqual(['Northwind Systems']);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'duplicate-record', path: 'accounts[1].Id' }),
    ]);
  });

  it('reports every issue a record has, in field order', () => {
    const result = normalizeCrmExport(
      {
        accounts: [
          {
            Id: '',
            Name: '',
            Type: 'Distributor',
            Tier__c: 'Tin',
            Region__c: 'ARCTIC',
            Account_Manager__c: '',
            Partner_Manager__c: 'pm-ana',
            Joined_Date__c: 'not-a-date',
            Is_Prospect__c: false,
          },
        ],
        opportunities: [],
      },
      context,
    );
    expect(result.partners).toEqual([]);
    expect(result.issues.map((item) => item.path)).toEqual([
      'accounts[0].Id',
      'accounts[0].Name',
      'accounts[0].Type',
      'accounts[0].Tier__c',
      'accounts[0].Region__c',
      'accounts[0].Account_Manager__c',
      'accounts[0].Joined_Date__c',
    ]);
  });

  it('rejects an export that is not the expected shape', () => {
    expect(normalizeCrmExport(null, context).issues).toEqual([
      expect.objectContaining({ code: 'malformed-record' }),
    ]);
    expect(normalizeCrmExport({ accounts: 'x', opportunities: [] }, context).issues).toEqual([
      expect.objectContaining({ code: 'malformed-record' }),
    ]);
  });
});

describe('normalizePrmRegistrations', () => {
  const context = { knownPartnerIds: KNOWN_PARTNERS, knownOpportunityIds: KNOWN_OPPORTUNITIES };

  it('normalizes registrations with provenance', () => {
    const before = snapshot(prmRegistrations);
    const result = normalizePrmRegistrations(prmRegistrations, context);
    expect(snapshot(prmRegistrations)).toBe(before);
    expect(result.issues).toEqual([]);
    expect(result.records.map((item) => item.record.id)).toEqual(['reg-501', 'reg-502']);
    expect(result.records[0]!.record).toMatchObject({
      partnerId: 'northwind',
      accountName: 'Acme Corp',
      amount: 240_000,
      status: 'approved',
      decisionAt: '2026-02-03T17:00:00.000Z',
      decidedBy: 'Dana Iyer',
      convertedTo: 'opp-1001',
    });
    expect(result.records[1]!.record.status).toBe('pending');
    expect(result.records[1]!.record.decisionAt).toBeUndefined();
    expect(result.records[0]!.provenance).toMatchObject({
      source: 'prm',
      sourceRecordId: 'reg-501',
    });
  });

  it('rejects a registration whose partner is unknown', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, partner_slug: 'acme-labs' }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'unknown-foreign-key', path: 'rows[0].partner_slug' }),
    ]);
  });

  it('rejects a conversion pointing at an unknown opportunity', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, opportunity_id: 'opp-9999' }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'unknown-foreign-key', path: 'rows[0].opportunity_id' }),
    ]);
  });

  it('rejects an approved registration with no decision facts', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, decided_at: null }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'inconsistent-state', path: 'rows[0].decided_at' }),
    ]);
  });

  it('rejects a pending registration that carries a decision time', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[1]!, decided_at: '2026-02-11T09:00:00Z' }],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'inconsistent-state', path: 'rows[0].decided_at' }),
    ]);
  });

  it('rejects a pending registration that carries any partial decision field', () => {
    // Pending means NO decision fields at all: a decider with no decision
    // time, or a rejection reason on an undecided row, is still a decision
    // fact the status contradicts.
    for (const partial of [
      { decided_by: 'Dana Iyer' },
      { rejection_reason: 'duplicate of reg-501' },
    ]) {
      const result = normalizePrmRegistrations([{ ...prmRegistrations[1]!, ...partial }], context);
      expect(result.records, JSON.stringify(partial)).toEqual([]);
      expect(result.issues, JSON.stringify(partial)).toEqual([
        expect.objectContaining({ code: 'inconsistent-state' }),
      ]);
    }
  });

  it('rejects an approved registration that carries a rejection reason', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, rejection_reason: 'wait, no' }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'inconsistent-state', path: 'rows[0].rejection_reason' }),
    ]);
  });

  it('rejects a decided registration that is missing its decider', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, decided_by: null }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'inconsistent-state', path: 'rows[0].decided_at' }),
    ]);
  });

  it('rejects a row whose present decision field fails its own read', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, decided_at: 'last Tuesday' }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-date', path: 'rows[0].decided_at' }),
    ]);
  });

  it('accepts the complete rejected combination: instant, decider, and reason', () => {
    const result = normalizePrmRegistrations(
      [
        {
          ...prmRegistrations[0]!,
          registration_id: 'reg-503',
          status: 'rejected' as const,
          rejection_reason: 'account already registered',
          opportunity_id: null,
        },
      ],
      context,
    );
    expect(result.issues).toEqual([]);
    expect(result.records[0]!.record).toMatchObject({
      status: 'rejected',
      decisionAt: '2026-02-03T17:00:00.000Z',
      decidedBy: 'Dana Iyer',
      reason: 'account already registered',
    });
  });

  it('preserves 1–3 digit timestamp fractions as milliseconds', () => {
    const cases: Array<[string, string]> = [
      ['2026-02-01T08:00:00.1Z', '2026-02-01T08:00:00.100Z'],
      ['2026-02-01T08:00:00.12Z', '2026-02-01T08:00:00.120Z'],
      ['2026-02-01T08:00:00.123Z', '2026-02-01T08:00:00.123Z'],
    ];
    for (const [submittedAt, expected] of cases) {
      const result = normalizePrmRegistrations(
        [{ ...prmRegistrations[1]!, submitted_at: submittedAt }],
        context,
      );
      expect(result.issues, submittedAt).toEqual([]);
      expect(result.records[0]!.record.submittedAt, submittedAt).toBe(expected);
    }
    // A fourth fraction digit is not accepted and silently trimmed: the
    // whole value fails, because `.1234` is not `.123`.
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[1]!, submitted_at: '2026-02-01T08:00:00.1234Z' }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-date', path: 'rows[0].submitted_at' }),
    ]);
  });

  it('keeps the fraction on an optional decision timestamp too', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, decided_at: '2026-02-03T17:00:00.5Z' }],
      context,
    );
    expect(result.issues).toEqual([]);
    expect(result.records[0]!.record.decisionAt).toBe('2026-02-03T17:00:00.500Z');
  });

  it('rejects a rejected registration with no reason', () => {
    const result = normalizePrmRegistrations(
      [
        {
          ...prmRegistrations[0]!,
          status: 'rejected' as const,
          rejection_reason: null,
        },
      ],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'inconsistent-state', path: 'rows[0].rejection_reason' }),
    ]);
  });

  it('rejects an unknown status instead of guessing pending', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, status: 'under-review' }],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'unknown-enum-value', path: 'rows[0].status' }),
    ]);
  });

  it('rejects a negative deal value instead of clamping it', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, deal_value: -5 }],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-money', path: 'rows[0].deal_value' }),
    ]);
  });

  it('rejects a non-UTC submitted timestamp instead of reading it as local', () => {
    const result = normalizePrmRegistrations(
      [{ ...prmRegistrations[0]!, submitted_at: '2026-02-01 08:00' }],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-date', path: 'rows[0].submitted_at' }),
    ]);
  });
});

describe('normalizeCalendarEvent', () => {
  it('normalizes a timed event with provenance', () => {
    const result = normalizeCalendarEvent(calendarEvents[0], CALENDAR_CONTEXT);
    expect(result).toMatchObject({
      ok: true,
      record: {
        id: 'evt-201',
        partnerId: 'northwind',
        partnerManagerId: 'pm-ana',
        type: 'discovery',
        occurredAt: '2026-02-20T14:30:00.000Z',
        durationMinutes: 45,
      },
      provenance: { source: 'calendar', sourceRecordId: 'evt-201' },
    });
  });

  it('pins an all-day event to noon UTC, not to the current time', () => {
    const result = normalizeCalendarEvent(calendarEvents[1], CALENDAR_CONTEXT);
    expect(result).toMatchObject({ ok: true, record: { occurredAt: '2026-02-25T12:00:00.000Z' } });
    if (result.ok) {
      expect(result.provenance.fields).toContain('all_day_date');
      expect(result.provenance.fields).not.toContain('start_at');
    }
  });

  it('rejects an event with neither a start nor an all-day date', () => {
    const result = normalizeCalendarEvent(
      { ...calendarEvents[0]!, start_at: null },
      CALENDAR_CONTEXT,
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'missing-field', path: 'start_at' }),
      ]);
    }
  });

  it('rejects a non-UTC timestamp instead of reading it as local', () => {
    const result = normalizeCalendarEvent(
      { ...calendarEvents[0]!, start_at: '2026-02-20 14:30' },
      CALENDAR_CONTEXT,
    );
    if (result.ok) expect.unreachable();
    else {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'invalid-date', path: 'start_at' }),
      ]);
    }
  });

  it('rejects an event whose partner manager is unknown', () => {
    const result = normalizeCalendarEvent(
      { ...calendarEvents[0]!, partner_manager_id: 'pm-nobody' },
      CALENDAR_CONTEXT,
    );
    if (result.ok) expect.unreachable();
    else {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'unknown-foreign-key', path: 'partner_manager_id' }),
      ]);
    }
  });

  it('rejects an unknown category instead of guessing a meeting type', () => {
    const result = normalizeCalendarEvent(
      { ...calendarEvents[0]!, category: 'Lunch' },
      CALENDAR_CONTEXT,
    );
    if (result.ok) expect.unreachable();
    else {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'unknown-enum-value', path: 'category' }),
      ]);
    }
  });

  it('rejects a fractional duration', () => {
    const result = normalizeCalendarEvent(
      { ...calendarEvents[0]!, duration_minutes: 44.5 },
      CALENDAR_CONTEXT,
    );
    if (result.ok) expect.unreachable();
    else {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'invalid-integer', path: 'duration_minutes' }),
      ]);
    }
  });
});

describe('normalizeEnablementExport', () => {
  const context = { knownPartnerIds: KNOWN_PARTNERS };

  it('normalizes classifications with provenance', () => {
    const before = snapshot(enablementRows);
    const result = normalizeEnablementExport(enablementRows, context);
    expect(snapshot(enablementRows)).toBe(before);
    expect(result.issues).toEqual([]);
    expect(result.records.map((item) => item.record)).toEqual([
      { partnerId: 'northwind', type: 'technical-enablement' },
      { partnerId: 'contoso', type: 'gtm-enablement' },
    ]);
    expect(result.records[0]!.provenance).toMatchObject({ source: 'enablement' });
  });

  it('rejects a session kind the enablement system never reports', () => {
    const result = normalizeEnablementExport(
      [{ partner_slug: 'northwind', session_kind: 'Discovery Call' }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'unknown-enum-value', path: 'rows[0].session_kind' }),
    ]);
  });

  it('rejects a classification for a partner the context does not know', () => {
    const result = normalizeEnablementExport(
      [{ partner_slug: 'acme-labs', session_kind: 'GTM Enablement' }],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'unknown-foreign-key', path: 'rows[0].partner_slug' }),
    ]);
  });

  it('rejects a repeated (partner, kind) pair instead of double-counting it', () => {
    const result = normalizeEnablementExport([enablementRows[0]!, enablementRows[0]!], context);
    expect(result.records).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'duplicate-record', path: 'rows[1]' }),
    ]);
  });
});

describe('normalizeTargetsExport', () => {
  const context = { knownPartnerIds: KNOWN_PARTNERS };

  it('normalizes targets with provenance', () => {
    const before = snapshot(targetRows);
    const result = normalizeTargetsExport(targetRows, context);
    expect(snapshot(targetRows)).toBe(before);
    expect(result.issues).toEqual([]);
    expect(result.records.map((item) => item.record)).toEqual([
      { partnerId: 'northwind', quarter: 'FY27-Q1', revenueTarget: 1_200_000 },
      { partnerId: 'contoso', quarter: 'FY27-Q1', revenueTarget: 800_000 },
    ]);
    expect(result.records[0]!.provenance).toMatchObject({
      source: 'targets',
      sourceRecordId: 'northwind:FY27-Q1',
    });
  });

  it('accepts a zero quota instead of treating it as missing', () => {
    const result = normalizeTargetsExport([{ ...targetRows[0]!, quota_amount: 0 }], context);
    expect(result.issues).toEqual([]);
    expect(result.records[0]!.record.revenueTarget).toBe(0);
  });

  it('rejects a missing quota instead of defaulting it to zero', () => {
    const result = normalizeTargetsExport([{ ...targetRows[0]!, quota_amount: null }], context);
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'missing-field', path: 'rows[0].quota_amount' }),
    ]);
  });

  it('rejects a NaN quota', () => {
    const result = normalizeTargetsExport(
      [{ ...targetRows[0]!, quota_amount: Number.NaN }],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-money', path: 'rows[0].quota_amount' }),
    ]);
  });

  it('rejects a quarter label that is not a fiscal quarter', () => {
    const result = normalizeTargetsExport(
      [{ ...targetRows[0]!, fiscal_period: 'Q1 2027' }],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-string', path: 'rows[0].fiscal_period' }),
    ]);
  });

  it('rejects a second target for a partner and quarter it already has', () => {
    const result = normalizeTargetsExport(
      [targetRows[0]!, { ...targetRows[0]!, quota_amount: 9 }],
      context,
    );
    expect(result.records).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'duplicate-record', path: 'rows[1].fiscal_period' }),
    ]);
  });
});

describe('normalizeCertificationsExport', () => {
  const context = { knownPartnerIds: KNOWN_PARTNERS };

  it('normalizes certification standing with provenance', () => {
    const before = snapshot(certificationRows);
    const result = normalizeCertificationsExport(certificationRows, context);
    expect(snapshot(certificationRows)).toBe(before);
    expect(result.issues).toEqual([]);
    expect(result.records.map((item) => item.record)).toEqual([
      {
        partnerId: 'northwind',
        partnerStrategistsCertified: 3,
        partnerStrategistsGoal: 2,
        partnerEngineersCertified: 1,
        partnerEngineersGoal: 2,
      },
      {
        partnerId: 'contoso',
        partnerStrategistsCertified: 0,
        partnerStrategistsGoal: 1,
        partnerEngineersCertified: 2,
        partnerEngineersGoal: 2,
      },
    ]);
    expect(result.records[0]!.provenance).toMatchObject({
      source: 'certifications',
      sourceRecordId: 'northwind',
    });
  });

  it('rejects a fractional certified count', () => {
    const result = normalizeCertificationsExport(
      [{ ...certificationRows[0]!, engineers_certified: 1.5 }],
      context,
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-integer', path: 'rows[0].engineers_certified' }),
    ]);
  });

  it('rejects a certification row for a partner the context does not know', () => {
    const result = normalizeCertificationsExport(
      [{ ...certificationRows[0]!, partner_slug: 'acme-labs' }],
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'unknown-foreign-key', path: 'rows[0].partner_slug' }),
    ]);
  });

  it('rejects a second row for a partner instead of summing them', () => {
    const result = normalizeCertificationsExport(
      [certificationRows[0]!, certificationRows[0]!],
      context,
    );
    expect(result.records).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'duplicate-record', path: 'rows[1].partner_slug' }),
    ]);
  });
});
