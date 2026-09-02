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

  // ---- Geofencing ----
  /** Default radius applied to a site's geofence when one hasn't been configured yet. */
  defaultGeofenceRadiusMeters: 2000,
  /** Distance beyond the radius, as a fraction of the radius, that counts as
   *  "near boundary" rather than fully inside (e.g. 0.85 = last 15% of the radius). */
  nearBoundaryRatio: 0.85,
  /** Distance past the radius (meters) at which an OUTSIDE violation escalates
   *  from WARNING to CRITICAL. */
  geofenceCriticalOverageMeters: 1500,

  // ---- Financial intelligence (all configurable; used for transparent, deterministic math) ----
  financial: {
    /** Fallback fuel cost when an asset-specific rate isn't known, $/liter. */
    fuelCostPerLiter: 1.35,
    /** Fully-loaded cost of an idle hour beyond wear/fuel (yard space, opportunity cost), $/hr. */
    idleOverheadPerHour: 22,
    /** Flat cost estimate to physically relocate/transport a unit between sites. */
    transportCostFlat: 650,
    /** Estimated labor cost per hour for a certified operator. */
    laborCostPerHour: 65,
  },
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
