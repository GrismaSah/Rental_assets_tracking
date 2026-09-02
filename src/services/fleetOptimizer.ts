import { Asset, Site, Operator, GeofenceEvent, OptimizationRecommendation } from '../types';
import { BUSINESS_RULES } from '../config/businessRules';
import { haversineDistanceMeters } from '../utils/geo';

export interface OptimizerInput {
  assets: Asset[];
  sites: Site[];
  operators: Operator[];
  geofenceEvents?: GeofenceEvent[];
}

export type DraftRecommendation = Omit<OptimizationRecommendation, 'id' | 'decision' | 'created_at' | 'decided_at'>;

const utilizationOf = (a: Asset) => a.engine_hours_day / Math.max(a.engine_hours_day + a.idle_hours_day, 0.1);

/** Idle waste per day for an asset: rental accrues regardless, plus fuel
 *  burned at idle (~28% of full duty-cycle burn) and a fixed overhead
 *  allowance for yard space / opportunity cost. All rates come from
 *  BUSINESS_RULES.financial so the math stays transparent and configurable. */
function dailyIdleWasteUsd(asset: Asset): number {
  const { fuelCostPerLiter, idleOverheadPerHour } = BUSINESS_RULES.financial;
  const idleFuelBurn = asset.idle_hours_day * asset.fuel_burn_rate_lph * 0.28 * fuelCostPerLiter;
  const overhead = asset.idle_hours_day * idleOverheadPerHour;
  return Math.round(idleFuelBurn + overhead);
}

/**
 * Deterministic rules-based fleet optimizer. Produces structured relocation /
 * early-return / operator-assignment recommendations from the *current*
 * persisted fleet state -- no numbers here are invented by an LLM; the AI
 * assistant only ever explains what this function already computed.
 */
export function generateOptimizationRecommendations(input: OptimizerInput): DraftRecommendation[] {
  const { assets, sites, operators } = input;
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const recs: DraftRecommendation[] = [];

  // Demand pressure per site: how far short a site is running of its
  // configured target headcount. Positive = the site has fewer active units
  // deployed than planned, i.e. unmet demand -- a real relocation candidate.
  const activeCountBySite = new Map<string, number>();
  for (const a of assets) {
    if (a.status === 'Active' && a.site_id) {
      activeCountBySite.set(a.site_id, (activeCountBySite.get(a.site_id) || 0) + 1);
    }
  }
  const demandPressure = (siteId: string) => {
    const site = siteById.get(siteId);
    if (!site) return 0;
    const active = activeCountBySite.get(siteId) || 0;
    return site.active_machinery_count - active; // positive = short of planned headcount
  };

  // ---- RELOCATE_ASSET: low-utilization active assets vs. understaffed sites ----
  const underutilized = assets.filter(
    (a) => a.status === 'Active' && a.site_id && utilizationOf(a) < 0.4 && a.idle_hours_day >= 4
  );
  for (const asset of underutilized) {
    const currentSite = siteById.get(asset.site_id);
    if (!currentSite) continue;
    const candidates = sites
      .filter((s) => s.id !== asset.site_id)
      .map((s) => ({ site: s, pressure: demandPressure(s.id), distanceKm: haversineDistanceMeters(currentSite.location, s.location) / 1000 }))
      .filter((c) => c.pressure > 0)
      .sort((a, b) => b.pressure - a.pressure || a.distanceKm - b.distanceKm);
    const target = candidates[0];
    if (!target) continue;

    const certifiedOperator = operators.find(
      (o) => o.certified_equipment.includes(asset.type) && (!o.current_site_id || o.current_site_id === target.site.id)
    );

    const dailyWaste = dailyIdleWasteUsd(asset);
    const weeklySavings = Math.max(dailyWaste * 7 - BUSINESS_RULES.financial.transportCostFlat, dailyWaste * 3);
    const idleReduction = Math.min(80, Math.round((1 - utilizationOf(asset)) * 60 + 20));
    const utilizationGain = Math.min(90, Math.round((0.75 - utilizationOf(asset)) * 100));
    const fuelImpact = Math.round(Math.min(20, asset.idle_hours_day * 0.9));

    recs.push({
      type: 'RELOCATE_ASSET',
      priority: dailyWaste > 250 ? 'HIGH' : dailyWaste > 100 ? 'MEDIUM' : 'LOW',
      asset_id: asset.id,
      from_site: currentSite.id,
      to_site: target.site.id,
      operator_id: certifiedOperator?.id || null,
      reason: `${asset.id} utilization is ${Math.round(utilizationOf(asset) * 100)}% at ${currentSite.name} (${asset.idle_hours_day}h idle/day) while ${target.site.name} is running ${target.pressure} unit(s) short of its planned headcount. ${target.distanceKm < 400 ? `Available within ${Math.round(target.distanceKm)} km.` : `${Math.round(target.distanceKm)} km transport.`}${certifiedOperator ? ` ${certifiedOperator.name} is certified and available.` : ' No certified operator currently free for the destination.'}`,
      estimated_savings: Math.round(weeklySavings),
      idle_reduction_percent: idleReduction,
      utilization_gain_percent: Math.max(utilizationGain, 5),
      fuel_impact_percent: fuelImpact,
      confidence: certifiedOperator ? 91 : 78,
      actions: ['Approve relocation', 'Notify site supervisor', ...(certifiedOperator ? [`Assign ${certifiedOperator.name} as operator`] : ['Assign a certified operator'])],
    });
  }

  // ---- RETURN_EARLY: active, unassigned-or-idle-with-no-site, still on rental ----
  const returnCandidates = assets.filter(
    (a) => a.status === 'Active' && (!a.site_id || !a.operator_id) && a.idle_hours_day >= 6
  );
  for (const asset of returnCandidates) {
    const dailyWaste = dailyIdleWasteUsd(asset) + asset.rental_rate_daily * 0.5; // half the day rate is pure waste if it can't be redeployed
    recs.push({
      type: 'RETURN_EARLY',
      priority: dailyWaste > 400 ? 'HIGH' : 'MEDIUM',
      asset_id: asset.id,
      from_site: asset.site_id || null,
      to_site: null,
      reason: `${asset.id} is ${!asset.site_id ? 'unassigned to any job site' : 'unassigned to an operator'} while still on an active rental, idling ${asset.idle_hours_day}h/day. Rental continues to accrue at $${asset.rental_rate_daily}/day with no productive work being captured.`,
      estimated_savings: Math.round(dailyWaste * 7),
      idle_reduction_percent: 100,
      utilization_gain_percent: 0,
      fuel_impact_percent: Math.round(Math.min(15, asset.idle_hours_day * 0.6)),
      confidence: 85,
      actions: ['Approve early return', 'Notify dealer / yard', 'Close rental agreement'],
    });
  }

  // ---- ASSIGN_OPERATOR: active asset with no operator, but a certified one is free ----
  const unassignedActive = assets.filter((a) => a.status === 'Active' && a.site_id && !a.operator_id);
  for (const asset of unassignedActive) {
    const busyOperatorIds = new Set(assets.filter((a) => a.operator_id).map((a) => a.operator_id));
    const candidate = operators.find(
      (o) => o.certified_equipment.includes(asset.type) && !busyOperatorIds.has(o.id) && (!o.current_site_id || o.current_site_id === asset.site_id)
    );
    if (!candidate) continue;
    const dailyWaste = dailyIdleWasteUsd(asset);
    recs.push({
      type: 'ASSIGN_OPERATOR',
      priority: 'HIGH',
      asset_id: asset.id,
      from_site: asset.site_id,
      to_site: asset.site_id,
      operator_id: candidate.id,
      reason: `${asset.id} is active at ${asset.site_name} with no assigned operator. ${candidate.name} is certified for ${asset.type} and not currently assigned elsewhere.`,
      estimated_savings: Math.round(dailyWaste * 7),
      idle_reduction_percent: 70,
      utilization_gain_percent: 45,
      fuel_impact_percent: 5,
      confidence: 94,
      actions: [`Assign ${candidate.name}`, 'Notify site supervisor'],
    });
  }

  return recs.sort((a, b) => (b.priority === a.priority ? b.estimated_savings - a.estimated_savings : b.priority === 'HIGH' ? 1 : -1));
}
