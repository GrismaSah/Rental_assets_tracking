import { Asset, AnomalyAlert } from '../types';

export function runAnomalyDetection(assets: Asset[]): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];

  assets.forEach((asset) => {
    // Rule 1: High Idle Hours (> 8 hours/day)
    if (asset.idle_hours_day > 8) {
      const estimatedWastedCost = Math.round(asset.idle_hours_day * asset.operating_days * 38);
      alerts.push({
        id: `ANOM-IDLE-${asset.id}`,
        asset_id: asset.id,
        type: 'High Idle',
        severity: asset.idle_hours_day >= 11 ? 'Critical' : 'Warning',
        description: `Severe machine idling detected at ${asset.site_name}. Machine is idling ${asset.idle_hours_day} hrs/day (${Math.round((asset.idle_hours_day / (asset.idle_hours_day + Math.max(asset.engine_hours_day, 0.1))) * 100)}% of shift).`,
        metric_value: `${asset.idle_hours_day}h idle / day`,
        recommendation: `Reallocate asset to an active site or return early to save ~$${estimatedWastedCost.toLocaleString()} in wasted rental & fuel costs.`,
        timestamp: 'Real-Time Rule Trigger',
        resolved: false,
      });
    }

    // Rule 2: Unassigned Operator while machine is on rental / checked out
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

    // Rule 3: Approaching / Overdue return date
    const checkinDate = new Date(asset.checkin_date);
    const now = new Date('2025-04-10'); // Anchor demo baseline
    const diffDays = Math.ceil((checkinDate.getTime() - now.getTime()) / (1000 * 3600 * 24));

    if (diffDays < 0) {
      alerts.push({
        id: `ANOM-EXP-${asset.id}`,
        asset_id: asset.id,
        type: 'Overdue Rental',
        severity: 'Critical',
        description: `Rental lease expired ${Math.abs(diffDays)} days ago on ${asset.checkin_date}. Accruing unplanned demurrage rates.`,
        metric_value: `${Math.abs(diffDays)} days overdue`,
        recommendation: `Trigger mandatory return check-in or extend contractual rental lease with Caterpillar dealer.`,
        timestamp: 'Contract Rule Trigger',
        resolved: false,
      });
    } else if (diffDays <= 3) {
      alerts.push({
        id: `ANOM-EXP-WARN-${asset.id}`,
        asset_id: asset.id,
        type: 'Approaching Return',
        severity: 'Warning',
        description: `Rental agreement expires in ${diffDays} day(s) (${asset.checkin_date}). Plan haulage transport.`,
        metric_value: `Due in ${diffDays}d`,
        recommendation: `Schedule site demobilization and dispatch flatbed transport.`,
        timestamp: 'Contract Rule Trigger',
        resolved: false,
      });
    }

    // Rule 4: Low Health Score / Imminent Service
    if (asset.health_score < 70 || asset.status === 'Under Maintenance' || asset.next_maintenance_hours <= 0) {
      alerts.push({
        id: `ANOM-MAINT-${asset.id}`,
        asset_id: asset.id,
        type: 'Low Health / Maintenance',
        severity: asset.health_score < 60 ? 'Critical' : 'Warning',
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
