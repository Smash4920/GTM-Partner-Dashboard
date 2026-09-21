import type {
  ActivityMeeting,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerCertification,
  PartnerManager,
  Target,
} from './types';

/**
 * The integration seam. The UI only ever talks to this interface.
 *
 * MockDataProvider fills it today. A future CRM-backed provider (HubSpot,
 * Salesforce, or a warehouse) can implement the same four methods and the
 * entire dashboard keeps working untouched. See README "Data contract".
 */
export interface DataProvider {
  listPartnerManagers(): Promise<PartnerManager[]>;
  listPartners(): Promise<Partner[]>;
  listRegistrations(): Promise<DealRegistration[]>;
  listOpportunities(): Promise<Opportunity[]>;
  getTargets(): Promise<Target[]>;
  listActivities(): Promise<ActivityMeeting[]>;
  listCertifications(): Promise<PartnerCertification[]>;
}
