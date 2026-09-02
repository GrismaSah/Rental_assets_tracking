import { Asset, Site, Operator, AnomalyAlert, GeofenceEvent, OptimizationRecommendation } from '../types';
import { BUSINESS_RULES } from '../config/businessRules';

export interface FleetContextInput {
  assets: Asset[];
  sites: Site[];
  operators: Operator[];
  alerts: AnomalyAlert[];
  openGeofenceEvents: GeofenceEvent[];
  recommendations: OptimizationRecommendation[];
}

/**
 * Builds a small, deterministic, pre-computed summary of live fleet state for
 * the AI Copilot. The model never sees the raw database -- only this
 * summary -- and every number in it is computed here in plain TypeScript, not
 * guessed by the model. The assistant's job is to explain/prioritize this
 * data in natural language, not to calculate it.
 */
export function buildFleetContext(input: FleetContextInput) {
  const { assets, sites, operators, alerts, openGeofenceEvents, recommendations } = input;
  const { fuelCostPerLiter, idleOverheadPerHour } = BUSINESS_RULES.financial;

  const dailyIdleWaste = (a: Asset) =>
    Math.round(a.idle_hours_day * a.fuel_burn_rate_lph * 0.28 * fuelCostPerLiter + a.idle_hours_day * idleOverheadPerHour);

  const totalDailyIdleWasteUsd = assets.reduce((sum, a) => sum + dailyIdleWaste(a), 0);

  const overdue = assets.filter((a) => a.status === 'Active' && new Date(a.checkin_date) < new Date());
  const highIdle = assets.filter((a) => a.idle_hours_day > BUSINESS_RULES.highIdleHoursPerDay.warning);
  const maintenanceRisk = assets.filter((a) => a.health_score < BUSINESS_RULES.maintenanceHealthWarning || a.status === 'Under Maintenance');
  const unassignedOperator = assets.filter((a) => a.status === 'Active' && !a.operator_id);
  const unassignedSite = assets.filter((a) => !a.site_id);

  return {
    generated_at: new Date().toISOString(),
    fleet_summary: {
      total_assets: assets.length,
      active: assets.filter((a) => a.status === 'Active').length,
      idle: assets.filter((a) => a.status === 'Idle').length,
      under_maintenance: assets.filter((a) => a.status === 'Under Maintenance').length,
      overdue_rentals: overdue.length,
      high_idle_units: highIdle.length,
      maintenance_risk_units: maintenanceRisk.length,
      unassigned_operator_units: unassignedOperator.length,
      unassigned_site_units: unassignedSite.length,
      active_geofence_violations: openGeofenceEvents.length,
      estimated_daily_idle_waste_usd: totalDailyIdleWasteUsd,
      estimated_weekly_idle_waste_usd: totalDailyIdleWasteUsd * 7,
    },
    assets: assets.map((a) => ({
      id: a.id,
      type: a.type,
      model: a.model,
      status: a.status,
      site: a.site_name || 'Unassigned',
      site_id: a.site_id || null,
      operator: a.operator_name || 'Unassigned',
      engine_hours_day: a.engine_hours_day,
      idle_hours_day: a.idle_hours_day,
      fuel_level_pct: a.fuel_level_pct,
      health_score: a.health_score,
      checkin_date: a.checkin_date,
      is_overdue: a.status === 'Active' && new Date(a.checkin_date) < new Date(),
      geofence_status: a.geofence_status || 'UNKNOWN',
      estimated_daily_idle_waste_usd: dailyIdleWaste(a),
    })),
    sites: sites.map((s) => ({ id: s.id, name: s.name, project_type: s.project_type, planned_headcount: s.active_machinery_count, active_now: assets.filter((a) => a.site_id === s.id && a.status === 'Active').length })),
    operators: operators.map((o) => ({ id: o.id, name: o.name, certified_equipment: o.certified_equipment, current_site_id: o.current_site_id || null, currently_assigned_asset: assets.find((a) => a.operator_id === o.id)?.id || null })),
    active_alerts: alerts.filter((a) => !a.resolved).map((a) => ({ id: a.id, asset_id: a.asset_id, type: a.type, severity: a.severity, description: a.description, recommendation: a.recommendation })),
    geofence_violations: openGeofenceEvents.map((e) => ({ asset_id: e.asset_id, site_id: e.site_id, distance_m: Math.round(e.distance_m), severity: e.severity, violation_started_at: e.violation_started_at })),
    top_recommendations: recommendations.filter((r) => r.decision === 'PENDING').slice(0, 5).map((r) => ({ id: r.id, type: r.type, asset_id: r.asset_id, from_site: r.from_site, to_site: r.to_site, reason: r.reason, estimated_savings: r.estimated_savings, confidence: r.confidence })),
  };
}

export type FleetContext = ReturnType<typeof buildFleetContext>;
