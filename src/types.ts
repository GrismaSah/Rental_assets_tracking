export type AssetStatus = 'Active' | 'Idle' | 'Under Maintenance' | 'Pending Check-In' | 'Alert';

export type EquipmentType = 'Excavator' | 'Crane' | 'Bulldozer' | 'Grader' | 'Wheel Loader' | 'Compactor';

export type GeofenceStatus = 'INSIDE' | 'NEAR_BOUNDARY' | 'OUTSIDE' | 'UNKNOWN';

export interface Asset {
  id: string;
  type: EquipmentType;
  model: string;
  serial_number: string;
  site_id: string;
  site_name: string;
  checkout_date: string;
  checkin_date: string;
  engine_hours_day: number;
  idle_hours_day: number;
  operating_days: number;
  operator_id: string | null;
  operator_name: string | null;
  status: AssetStatus;
  location: [number, number]; // [lat, lng]
  fuel_level_pct: number;
  fuel_burn_rate_lph: number; // liters per hour
  health_score: number; // 0 - 100
  rental_rate_daily: number;
  last_maintenance_date: string;
  next_maintenance_hours: number;
  anomalies: string[];
  /** Cumulative engine meter reading, carried across rentals. Updated from
   *  the operator-entered odometer value at each check-in. */
  lifetime_engine_hours: number;
  /** Server-computed distance from the assigned site's geofence center, in meters. */
  geofence_distance_m?: number;
  geofence_status?: GeofenceStatus;
  tracking_enabled?: boolean;
  tracking_status?: string;
  last_telemetry_at?: string | null;
}

export interface Geofence {
  id: string;
  site_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GeofenceEvent {
  id: number;
  asset_id: string;
  geofence_id: string;
  site_id: string;
  status: GeofenceStatus;
  distance_m: number;
  severity: 'WARNING' | 'CRITICAL';
  violation_started_at: string;
  last_seen_at: string;
  violation_count: number;
  resolved_at: string | null;
}

export type OptimizationType = 'RELOCATE_ASSET' | 'RETURN_EARLY' | 'ASSIGN_OPERATOR';
export type OptimizationPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type OptimizationDecision = 'PENDING' | 'ACCEPTED' | 'DISMISSED';

export interface OptimizationRecommendation {
  id: string;
  type: OptimizationType;
  priority: OptimizationPriority;
  asset_id: string;
  from_site: string | null;
  to_site: string | null;
  operator_id?: string | null;
  reason: string;
  estimated_savings: number;
  idle_reduction_percent: number;
  utilization_gain_percent: number;
  fuel_impact_percent: number;
  confidence: number;
  actions: string[];
  decision: OptimizationDecision;
  created_at: string;
  decided_at?: string | null;
}

export interface Site {
  id: string;
  name: string;
  location: [number, number];
  city: string;
  state: string;
  project_type: string;
  active_machinery_count: number;
  supervisor: string;
  supervisor_email: string;
  supervisor_phone: string;
}

export interface Operator {
  id: string;
  name: string;
  certified_equipment: EquipmentType[];
  safety_score: number;
  contact: string;
  current_site_id?: string;
}

export interface InspectionCheckItem {
  id: string;
  category: 'Fluid Levels' | 'Hydraulics & Hoses' | 'Undercarriage & Tracks' | 'Safety & Cab' | 'Electrical & Lights';
  title: string;
  description: string;
  status: 'pass' | 'warning' | 'fail';
  notes?: string;
}

export interface InspectionRecord {
  id: string;
  asset_id: string;
  operator_id: string;
  timestamp: string;
  check_type: 'Check-In' | 'Check-Out' | 'Pre-Shift Safety';
  items: InspectionCheckItem[];
  risk_score: number; // 0 (Prisinte) - 100 (Severe Risk)
  risk_level: 'Low' | 'Moderate' | 'High' | 'Critical';
  odometer_hours: number;
  inspector_name: string;
  passed: boolean;
  action_required?: string;
}

export interface AnomalyAlert {
  id: string;
  asset_id: string;
  type: 'High Idle' | 'Unassigned Operator' | 'Unassigned Equipment' | 'Approaching Return' | 'Overdue Rental' | 'Low Health / Maintenance' | 'Excess Fuel Burn' | 'Operator Not Certified' | 'Geofence Violation';
  severity: 'Critical' | 'Warning' | 'Info';
  description: string;
  metric_value: string;
  recommendation: string;
  timestamp: string;
  resolved: boolean;
  notifications?: NotificationDispatch[];
  notified_at?: string;
}

// Multi-channel delivery so the alert reaches whoever needs it: the office
// (email, for a compliance/audit trail), the operator's own phone (SMS), and
// the machine itself (in-cab console + audible alarm via Cat Product Link-style
// telematics) — the last one is what still reaches the operator even if their
// phone was left outside the cab, since it doesn't depend on a phone at all.
export type NotificationChannel = 'Email' | 'SMS' | 'In-Cab Console Alert';

export interface NotificationDispatch {
  channel: NotificationChannel;
  recipient: string;
  status: 'Sent' | 'Delivered';
  detail: string;
}

// Permanent audit-trail record of an alert: unlike AnomalyAlert (which only
// reflects currently-active conditions), this persists even after the
// underlying issue clears, so compliance/history review isn't limited to
// "what's wrong right now."
export interface AlertHistoryEntry extends AnomalyAlert {
  first_seen_at: string;
  cleared_at?: string;
}

export interface DemandForecastResult {
  site_id: string;
  site_name: string;
  project_type: string;
  duration_weeks: number;
  target_volume_m3: number;
  recommended_fleet: {
    type: EquipmentType;
    model: string;
    count: number;
    hours_needed: number;
    est_fuel_burn_liters: number;
    est_rental_cost: number;
    utilization_confidence: number;
  }[];
  peak_workload_week: number;
  total_fleet_cost: number;
  co2_emission_est_tons: number;
  ai_insights: string;
  source: 'gemini' | 'rules-engine';
}
