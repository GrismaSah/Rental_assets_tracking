/**
 * Stable business rules for the Rental Asset Tracking brief.
 *
 * Keep all thresholds here. The API, telemetry simulator, dashboard and
 * alert evaluator must import this module instead of duplicating values.
 */
export const BUSINESS_RULES = {
  /**
   * The source brief's sample dataset was authored as of this instant.
   * initialAssets.ts re-anchors every seed date to "today" while preserving
   * each asset's offset from this reference point, so alert evaluation
   * below can safely use the real clock and still reproduce the brief's
   * intended overdue/approaching/healthy story on whatever day the app runs.
   */
  briefReferenceDate: '2025-04-12T12:00:00.000Z',
  highIdleHoursPerDay: {
    warning: 8,
    critical: 11,
  },
  returnDueSoonDays: 5,
  maintenanceHealthWarning: 70,
  maintenanceHealthCritical: 60,
  maintenanceHoursDue: 0,
  lowFuelPct: 15,
  /** Fuel burn ceiling by equipment type, in liters/hour, past which the
   *  unit is flagged as running inefficiently (worn injectors, wrong duty
   *  cycle, etc). Baselined from typical Cat OEM tier-4 duty-cycle figures. */
  fuelBurnCeilingLph: {
    Excavator: 18,
    Bulldozer: 26,
    Crane: 9,
    Grader: 18,
    'Wheel Loader': 17,
    Compactor: 11,
  } as Record<string, number>,
} as const;

export const BUSINESS_RULES_VERSION = '2025-04-brief-v2';

/**
 * A clock can be injected for repeatable unit tests; production and the live
 * demo both evaluate alerts against the real current time, since seed data
 * is re-anchored to "today" at load (see briefReferenceDate above).
 */
export function getRuleEvaluationTime(value?: Date | string): Date {
  if (value instanceof Date) return value;
  if (value) return new Date(value);
  return new Date();
}
