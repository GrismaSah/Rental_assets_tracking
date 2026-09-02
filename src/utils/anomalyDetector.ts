import { Asset, AnomalyAlert } from '../types';
import { BUSINESS_RULES, getRuleEvaluationTime } from '../config/businessRules';

export function runAnomalyDetection(assets: Asset[], evaluationTime?: Date | string): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];
  const now = getRuleEvaluationTime(evaluationTime);

  assets.forEach((asset) => {
    // Rule 1: High Idle Hours (> 8 hours/day)
    if (asset.idle_hours_day > BUSINESS_RULES.highIdleHoursPerDay.warning) {
      const estimatedWastedCost = Math.round(asset.idle_hours_day * asset.operating_days * 38);
      alerts.push({
        id: `ANOM-IDLE-${asset.id}`,
        asset_id: asset.id,
        type: 'High Idle',
        severity: asset.idle_hours_day >= BUSINESS_RULES.highIdleHoursPerDay.critical ? 'Critical' : 'Warning',
        description: `Severe machine idling detected at ${asset.site_name}. Machine is idling ${asset.idle_hours_day} hrs/day (${Math.round((asset.idle_hours_day / (asset.idle_hours_day + Math.max(asset.engine_hours_day, 0.1))) * 100)}% of shift).`,
        metric_value: `${asset.idle_hours_day}h idle / day`,
        recommendation: `Reallocate asset to an active site or return early to save ~$${estimatedWastedCost.toLocaleString()} in wasted rental & fuel costs.`,
        timestamp: 'Real-Time Rule Trigger',
        resolved: false,
      });
    }

    // Rule 2: Unassigned Equipment — sitting with no job site assignment at all.
    // Distinct from "Unassigned Operator" below: this flags a machine that
    // isn't even deployed anywhere, so nobody has eyes on it and it isn't
    // earning its rental cost.
    if (!asset.site_id) {
      alerts.push({
        id: `ANOM-SITE-${asset.id}`,
        asset_id: asset.id,
        type: 'Unassigned Equipment',
        severity: 'Warning',
        description: `Asset ${asset.id} (${asset.model}) has no job site assignment — it is sitting unassigned instead of deployed to active work.`,
        metric_value: `Site: Unassigned`,
        recommendation: `Assign this unit to an active job site or schedule its return to the dealer to stop unnecessary rental accrual.`,
        timestamp: 'Real-Time Rule Trigger',
        resolved: false,
      });
    }

    // Rule 3: Unassigned Operator while machine is on rental / checked out
    if (!asset.operator_id && asset.status !== 'Under Maintenance') {
      alerts.push({
        id: `ANOM-OP-${asset.id}`,
        asset_id: asset.id,
        type: 'Unassigned Operator',
        severity: 'Critical',
        description: `Asset ${asset.id} (${asset.model}) is active at ${asset.site_name} with NO assigned operator certified on this unit.`,
        metric_value: `Operator: NULL`,
        recommendation: `Assign a certified Cat operator immediately or place unit into secure standby lock.`,
        timestamp: 'Real-Time Rule Trigger',
        resolved: false,
      });
    }

    // Rule 4: Approaching / Overdue return date.
    // Per Cat Rental Store terms, the rental term only ends once the unit is
    // actually returned to the dealer, and overdue units continue to accrue
    // daily rental (demurrage) charges — so this only applies to units still
    // deployed on an active rental. A unit already checked back in (Idle /
    // Under Maintenance) is no longer "out" against its old checkin_date.
    if (asset.status === 'Active') {
      const checkinDate = new Date(asset.checkin_date);
      const diffDays = Math.ceil((checkinDate.getTime() - now.getTime()) / (1000 * 3600 * 24));

      if (diffDays < 0) {
        alerts.push({
          id: `ANOM-EXP-${asset.id}`,
          asset_id: asset.id,
          type: 'Overdue Rental',
          severity: 'Critical',
          description: `Rental lease expired ${Math.abs(diffDays)} days ago on ${asset.checkin_date}. Unit is continuing to accrue daily rental (demurrage) charges until returned.`,
          metric_value: `${Math.abs(diffDays)} days overdue`,
          recommendation: `Trigger mandatory return check-in immediately, or call the Cat dealer now to extend the rental agreement and stop further billing.`,
          timestamp: 'Contract Rule Trigger',
          resolved: false,
        });
      } else if (diffDays <= BUSINESS_RULES.returnDueSoonDays) {
        alerts.push({
          id: `ANOM-EXP-WARN-${asset.id}`,
          asset_id: asset.id,
          type: 'Approaching Return',
          severity: 'Warning',
          description: `Rental agreement expires in ${diffDays} day(s) (${asset.checkin_date}). Cat dealer guidance: contact the dealer as early as possible to extend or confirm return, since early communication avoids late fees.`,
          metric_value: `Due in ${diffDays}d`,
          recommendation: `Call the dealer now to either extend the agreement or schedule site demobilization and flatbed transport before the due date.`,
          timestamp: 'Contract Rule Trigger',
          resolved: false,
        });
      }
    }

    // Rule 5: Low Health Score / Imminent Service
    if (
      asset.health_score < BUSINESS_RULES.maintenanceHealthWarning ||
      asset.status === 'Under Maintenance' ||
      asset.next_maintenance_hours <= BUSINESS_RULES.maintenanceHoursDue
    ) {
      alerts.push({
        id: `ANOM-MAINT-${asset.id}`,
        asset_id: asset.id,
        type: 'Low Health / Maintenance',
        severity: asset.health_score < BUSINESS_RULES.maintenanceHealthCritical ? 'Critical' : 'Warning',
        description: `Cat Product Link™ diagnostic telemetry indicates maintenance required. Health index is ${asset.health_score}%.`,
        metric_value: `Health: ${asset.health_score}% | ${asset.next_maintenance_hours}h to service`,
        recommendation: `Dispatch Cat certified field technician for hydraulic and oil sample analysis.`,
        timestamp: 'Telemetry Anomaly Trigger',
        resolved: false,
      });
    }
  });

  return alerts;
}
