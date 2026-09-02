/**
 * Stable business rules for the Rental Asset Tracking brief.
 *
 * Keep all thresholds here. The API, telemetry simulator, dashboard and
 * alert evaluator must import this module instead of duplicating values.
 */
export const BUSINESS_RULES = {
  /** The supplied brief data is evaluated against this fixed demo instant. */
  demoAsOf: '2025-04-12T12:00:00.000Z',
  highIdleHoursPerDay: {
    warning: 8,
    critical: 11,
  },
  returnDueSoonDays: 5,
  maintenanceHealthWarning: 70,
  maintenanceHealthCritical: 60,
  maintenanceHoursDue: 0,
} as const;

export const BUSINESS_RULES_VERSION = '2025-04-brief-v1';

/**
 * A clock is injected so alert outcomes are repeatable in the assignment demo
 * and unit tests. Production telemetry will pass its actual event time here.
 */
export function getRuleEvaluationTime(value?: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(value ?? BUSINESS_RULES.demoAsOf);
}
