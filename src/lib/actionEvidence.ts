import type { ActionReason } from '../data/types';
import { formatDate } from './format';

/** Minimum public evidence, shared by disclosures and local notification drafts. */
export function actionEvidence(reason: ActionReason): string {
  switch (reason.category) {
    case 'stale-high-value':
      return `${reason.evidence.elapsedCalendarDays} calendar days since ${reason.evidence.basis} baseline ${formatDate(reason.evidence.baselineAt)}.`;
    case 'missing-next-step':
      return `Next step is blank; qualifying causes: ${reason.evidence.causes.join(', ')}. Expected close in ${reason.evidence.daysUntilClose} calendar days.`;
    case 'close-date-slip':
      return `Expected close moved from ${formatDate(reason.evidence.priorCloseDate)} to ${formatDate(reason.evidence.currentCloseDate)}: ${reason.evidence.deltaCalendarDays} calendar days later.`;
    case 'registration-sla':
      return `${reason.evidence.state}; submitted ${formatDate(reason.evidence.submittedAt)}, due ${formatDate(reason.evidence.dueAt)}. Waiting ${reason.evidence.businessDaysWaiting} business days; ${reason.evidence.businessDaysRemaining} business days remaining.`;
    case 'partner-health':
      return `Prior window (${formatDate(reason.evidence.priorWindow.startExclusive)}, ${formatDate(reason.evidence.priorWindow.endInclusive)}]; current window (${formatDate(reason.evidence.currentWindow.startExclusive)}, ${formatDate(reason.evidence.currentWindow.endInclusive)}]. ${reason.evidence.drivers.map((driver) => `${driver.driver}: ${driver.prior} → ${driver.current} ${driver.unit}`).join('; ')}.`;
  }
}
