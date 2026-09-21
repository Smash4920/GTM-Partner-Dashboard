import type { DataProvider } from '../DataProvider';
import type { DashboardData } from '../types';
import { generateDashboardData } from './generate';

/**
 * Mock implementation of the DataProvider seam: deterministic, seeded data
 * (see generate.ts). Swap this for a CRM-backed provider to go live; nothing
 * in the UI changes.
 */
export class MockDataProvider implements DataProvider {
  private readonly data: DashboardData;

  constructor() {
    this.data = generateDashboardData();
  }

  async listPartnerManagers() {
    return this.data.partnerManagers;
  }

  async listPartners() {
    return this.data.partners;
  }

  async listRegistrations() {
    return this.data.registrations;
  }

  async listOpportunities() {
    return this.data.opportunities;
  }

  async getTargets() {
    return this.data.targets;
  }

  async listActivities() {
    return this.data.activities;
  }

  async listCertifications() {
    return this.data.certifications;
  }
}
