# Glossary

These terms describe the revenue model used by the dashboard.

## Deal registration

A partner-submitted request to register a potential deal. `src/data/types.ts` stores the partner's estimated amount, submission date, status, decision metadata, rejection reason, and optional opportunity ID.

## Registration funnel

The progression from submitted registration to approved registration to a registration converted into an opportunity. The funnel also shows rejected and pending records. `src/lib/metrics.ts` keeps counts and submitted-dollar totals separate.

## Sell To

The company sells directly to the partner, so the partner is the customer. Sell To is visible to internal GTM leadership but is intentionally excluded from the partner portal.

## Sell With

A co-sell motion in which the partner is attached to a deal with an end customer. Sell With is visible in both views.

## Allocate

Allocated revenue or committed-spend drawdown attributed to the partner. Allocate is visible in both views.

## Opportunity stage

The open sales progression, in order: Discovery, Scope, Tech Validation, Business Case, Vendor of Choice, and Deal Desk Review. Won and Lost are terminal outcomes rather than open stages.

## Open pipeline

The sum and count of opportunities without a terminal outcome. `openPipeline` in `src/lib/metrics.ts` returns both values.

## Closed-won YTD

Opportunity amount for won deals whose close date falls from January 1 of the current year through the fixed snapshot date. The current mock year is 2026.

## Win rate

Won closed opportunities divided by all won and lost opportunities in the current year-to-date period.

## Target and attainment

`Target` records contain a partner, quarter, and revenue target. Attainment is closed-won YTD divided by the YTD target.

## Pipeline coverage

Open pipeline divided by the YTD quota still to close. If the target has already been met, the dashboard displays “Target met” instead of a ratio because coverage over a zero remaining quota is not meaningful.

## Snapshot date

The fixed date, 2026-09-18, used by the mock generator and relative calculations. It is defined in `src/data/constants.ts` as `SNAPSHOT_DATE`.

## Data provider

The `DataProvider` interface in `src/data/DataProvider.ts`. It is the integration seam between the UI and data source, with methods for partners, registrations, opportunities, and targets.

## Partner tier

The mock partner classification of Platinum, Gold, Silver, or Registered. The generator uses tiers to weight registration activity and quarterly targets.
