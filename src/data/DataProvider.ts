import type {
  ActivityMeeting,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerCertification,
  PartnerManager,
  PipelineSnapshot,
  Target,
} from './types';

/**
 * The integration seam. The UI only ever talks to this interface.
 *
 * MockDataProvider fills it today. A future CRM-backed provider (HubSpot,
 * Salesforce, or a warehouse) can implement the same methods and the entire
 * dashboard keeps working untouched. See README "Data contract".
 */
export interface DataProvider {
  listPartnerManagers(): Promise<PartnerManager[]>;
  listPartners(): Promise<Partner[]>;
  listRegistrations(): Promise<DealRegistration[]>;
  listOpportunities(): Promise<Opportunity[]>;
  /**
   * Weekly recordings of the open book. History is what makes week-over-week
   * movement and, later, forecast accuracy measurable; a provider with none
   * may return an empty array, and the views fall back to deriving what they
   * can from opportunity create and close dates.
   */
  listPipelineSnapshots(): Promise<PipelineSnapshot[]>;
  getTargets(): Promise<Target[]>;
  listActivities(): Promise<ActivityMeeting[]>;
  listCertifications(): Promise<PartnerCertification[]>;
}
