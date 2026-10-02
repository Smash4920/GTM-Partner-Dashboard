import { describe, expect, it } from 'vitest';
import { prepareNotificationDraft, type NotificationDraft } from './notifications';
import { makeTeamUser } from '../test/fixtures';

const recipient = makeTeamUser({ channels: ['email', 'slack'] });
const draft: NotificationDraft = {
  userId: recipient.id,
  kind: 'manual',
  subject: ' Subject ',
  body: ' Body ',
  channels: ['email', 'slack', 'slack'],
};

describe('current notification recipient preparation', () => {
  it.each(['invited', 'suspended'] as const)(
    'excludes current %s overrides over active evidence',
    (status) => {
      expect(
        prepareNotificationDraft(draft, recipient, {
          overrides: { [recipient.id]: { status } },
        }),
      ).toBeNull();
    },
  );

  it('intersects and deduplicates selected channels with the current configuration', () => {
    expect(
      prepareNotificationDraft(draft, recipient, {
        overrides: { [recipient.id]: { channels: ['slack', 'in-app'] } },
      }),
    ).toEqual({ ...draft, subject: 'Subject', body: 'Body', channels: ['slack'] });
    expect(
      prepareNotificationDraft(draft, recipient, {
        overrides: { [recipient.id]: { channels: [] } },
      }),
    ).toBeNull();
  });

  it('uses current additions instead of retained values and never changes the candidate ID', () => {
    expect(
      prepareNotificationDraft(draft, recipient, {
        added: [{ ...recipient, status: 'invited' }],
      }),
    ).toBeNull();
    expect(
      prepareNotificationDraft(draft, recipient, {
        added: [{ ...recipient, channels: ['email'] }],
      }),
    ).toEqual({ ...draft, subject: 'Subject', body: 'Body', channels: ['email'] });
    expect(
      prepareNotificationDraft(draft, undefined, {
        overrides: { [recipient.id]: recipient },
      }),
    ).toBeNull();
    expect(prepareNotificationDraft(draft, { ...recipient, id: 'other' })).toBeNull();
  });
});
