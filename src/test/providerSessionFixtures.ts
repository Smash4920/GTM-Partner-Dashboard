import type { ProviderBook } from '../data/mock/book';
import {
  makeCertification,
  makeMeeting,
  makeOpportunity,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTarget,
  makeTeamUser,
} from './fixtures';

/** All relationships are populated; a tag changes prose even when IDs collide. */
export function providerSessionBook(tag: string, namespace = tag): ProviderBook {
  const managers = [1, 2].map((index) => ({
    id: `${namespace}-manager-${index}`,
    name: `${tag} Manager ${index}`,
  }));
  const partners = managers.map((manager, index) =>
    makePartner({
      id: `${namespace}-partner-${index + 1}`,
      name: `${tag} Partner ${index + 1}`,
      partnerManagerId: manager.id,
    }),
  );
  return makeProviderBook({
    partnerManagers: managers,
    partners,
    opportunities: partners.flatMap((partner, index) => [
      makeOpportunity({
        id: `${namespace}-opp-${index + 1}`,
        partnerId: partner.id,
        accountName: `${tag} Account ${index + 1}`,
        forecastedRevenue: 500_000 - index * 100_000,
        notes: `${tag} source note`,
        nextStep: '',
        forecastCategory: 'pipeline',
      }),
      makeOpportunity({
        id: `${namespace}-won-${index + 1}`,
        partnerId: partner.id,
        accountName: `${tag} Won ${index + 1}`,
        outcome: 'won',
        forecastedRevenue: 100_000 - index * 50_000,
        closedAt: '2026-08-12T00:00:00.000Z',
      }),
    ]),
    registrations: partners.map((partner, index) =>
      makeRegistration({
        id: `${namespace}-reg-${index + 1}`,
        partnerId: partner.id,
        accountName: `${tag} Shared registration account`,
      }),
    ),
    activities: partners.map((partner, index) =>
      makeMeeting({
        id: `${namespace}-meeting-${index + 1}`,
        partnerId: partner.id,
        partnerManagerId: managers[index].id,
      }),
    ),
    certifications: partners.map((partner) => makeCertification({ partnerId: partner.id })),
    targets: partners.map((partner) => makeTarget({ partnerId: partner.id })),
    teamUsers: managers.map((manager, index) =>
      makeTeamUser({
        id: `${namespace}-actor-${index + 1}`,
        name: `${tag} Actor ${index + 1}`,
        email: `${tag.toLowerCase()}-${index + 1}@example.test`,
        partnerManagerId: manager.id,
      }),
    ),
  });
}
