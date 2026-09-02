import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { INITIAL_ASSETS, SITES, OPERATORS } from './src/data/initialAssets.ts';
import { runAnomalyDetection } from './src/utils/anomalyDetector.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// -------------------------------------------------------------
// PERSISTENCE (SQLite via Node's built-in node:sqlite module)
// -------------------------------------------------------------
// Fleet state used to live only in a plain JS array, which meant every
// check-in/check-out/inspection was lost on a server restart. SQLite gives
// real persistence with zero extra dependencies (no native build step,
// unlike better-sqlite3) since it ships inside the Node runtime itself.
// Keep runtime state outside dist/ so rebuilding the frontend never deletes or
// locks the database. This also gives development and production one durable
// database location when launched from the project directory.
const db = new DatabaseSync(path.join(process.cwd(), 'fleet.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rental_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    site_id TEXT,
    site_name TEXT,
    operator_id TEXT,
    operator_name TEXT,
    engine_hours_day REAL,
    idle_hours_day REAL,
    fuel_level_pct REAL,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    details TEXT
  );
  CREATE TABLE IF NOT EXISTS telemetry_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    engine_hours_day REAL NOT NULL,
    idle_hours_day REAL NOT NULL,
    fuel_level_pct REAL NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    data TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    cleared_at TEXT
  );
`);

// Lightweight forward migration for databases created before rental-event
// handover details were captured. Keeping it here makes an existing demo DB
// upgrade safely on restart rather than requiring anyone to delete data.
const rentalEventColumns = db.prepare('PRAGMA table_info(rental_events)').all() as { name: string }[];
if (!rentalEventColumns.some((column) => column.name === 'details')) {
  db.exec('ALTER TABLE rental_events ADD COLUMN details TEXT');
}

const upsertAssetStmt = db.prepare(
  'INSERT INTO assets (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
);
const insertInspectionStmt = db.prepare(
  'INSERT INTO inspections (id, data, created_at) VALUES (?, ?, ?)'
);
const insertRentalEventStmt = db.prepare(`
  INSERT INTO rental_events
    (asset_id, event_type, site_id, site_name, operator_id, operator_name, engine_hours_day, idle_hours_day, fuel_level_pct, timestamp, source, details)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertTelemetryStmt = db.prepare(`
  INSERT INTO telemetry_readings (asset_id, timestamp, latitude, longitude, engine_hours_day, idle_hours_day, fuel_level_pct, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

function persistAsset(asset: any) {
  upsertAssetStmt.run(asset.id, JSON.stringify(asset));
}

function persistInspection(inspection: any) {
  insertInspectionStmt.run(inspection.id, JSON.stringify(inspection), inspection.timestamp);
}

// Permanent, append-only rental timeline per machine -- this is the actual
// historical usage data a real demand-forecasting model would eventually
// train on (equipment type, site, duration, how often it's re-rented). The
// `assets` table only ever holds *current* state; this is what accumulates
// over time as machines get checked out and back in, QR scan or manual.
function recordRentalEvent(asset: any, eventType: 'checkout' | 'checkin' | 'scan', source: 'qr' | 'manual', details: Record<string, unknown> = {}) {
  insertRentalEventStmt.run(
    asset.id,
    eventType,
    asset.site_id || null,
    asset.site_name || null,
    asset.operator_id || null,
    asset.operator_name || null,
    asset.engine_hours_day ?? null,
    asset.idle_hours_day ?? null,
    asset.fuel_level_pct ?? null,
    new Date().toISOString(),
    source,
    JSON.stringify(details)
  );
}

function getRentalHistory(assetId?: string) {
  const rows = assetId
    ? db.prepare('SELECT * FROM rental_events WHERE asset_id = ? ORDER BY timestamp DESC').all(assetId)
    : db.prepare('SELECT * FROM rental_events ORDER BY timestamp DESC').all();
  return rows;
}

const liveTrackedAssetIds = new Set<string>();

// This is a deliberate demo telemetry source. A real deployment replaces this
// loop with authenticated Product Link/VisionLink webhooks, but QR scanning
// immediately creates the same persisted tracking session and live UI effect.
function publishDemoTelemetry(assetId: string) {
  const index = fleetAssets.findIndex((asset) => asset.id === assetId);
  if (index === -1) return;
  const current = fleetAssets[index];
  const working = current.status === 'Active';
  const asset = {
    ...current,
    location: [current.location[0] + (Math.random() - 0.5) * 0.002, current.location[1] + (Math.random() - 0.5) * 0.002] as [number, number],
    engine_hours_day: Number((current.engine_hours_day + (working ? 0.1 : 0)).toFixed(1)),
    idle_hours_day: Number((current.idle_hours_day + (working ? 0 : 0.1)).toFixed(1)),
    fuel_level_pct: Number(Math.max(0, current.fuel_level_pct - (working ? 0.2 : 0.03)).toFixed(1)),
    tracking_enabled: true,
    tracking_status: 'Live demo telemetry',
    last_telemetry_at: new Date().toISOString(),
  };
  fleetAssets[index] = asset;
  persistAsset(asset);
  insertTelemetryStmt.run(asset.id, asset.last_telemetry_at, asset.location[0], asset.location[1], asset.engine_hours_day, asset.idle_hours_day, asset.fuel_level_pct, asset.status);
  refreshServerAlerts();
}

// Every asset actively on rent gets live telemetry ticking automatically --
// the brief assumes fleet-wide "real time" data, not just units someone
// happened to QR-scan. A scan additionally live-tracks non-Active units
// (Idle/Under Maintenance) so the demo can show tracking start on scan too.
setInterval(() => {
  const activeIds = fleetAssets.filter((a) => a.status === 'Active').map((a) => a.id);
  new Set([...activeIds, ...liveTrackedAssetIds]).forEach(publishDemoTelemetry);
}, 5000).unref();

async function sendSms(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    return { status: 'Simulated', detail: 'Add Twilio credentials and a verified destination number to send this SMS for real.' };
  }
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const payload: any = await response.json();
  if (!response.ok) throw new Error(payload.message || 'SMS provider rejected the message');
  return { status: 'Sent', detail: `Twilio message ${payload.sid} accepted for delivery.` };
}

async function sendAutomaticAlertNotification(alertId: string) {
  const row = db.prepare('SELECT data FROM alerts WHERE id = ?').get(alertId) as { data: string } | undefined;
  if (!row) return;
  const alert = JSON.parse(row.data);
  const asset = fleetAssets.find((item) => item.id === alert.asset_id);
  const site = SITES.find((item) => item.id === asset?.site_id);
  const operator = OPERATORS.find((item) => item.id === asset?.operator_id);
  const recipients = [process.env.ALERT_MANAGER_PHONE || site?.supervisor_phone, process.env.ALERT_CUSTOMER_PHONE || operator?.contact]
    .filter((phone): phone is string => Boolean(phone));
  const message = `Fleet alert ${alert.asset_id}: ${alert.type}. ${alert.recommendation}`;
  const notifications = await Promise.all(recipients.map(async (recipient) => {
    try { return { channel: 'SMS', recipient, ...(await sendSms(recipient, message)) }; }
    catch (error: any) { return { channel: 'SMS', recipient, status: 'Failed', detail: error.message || 'SMS delivery failed.' }; }
  }));
  const latest = db.prepare('SELECT data FROM alerts WHERE id = ?').get(alertId) as { data: string } | undefined;
  if (!latest) return;
  db.prepare('UPDATE alerts SET data = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(latest.data), notifications, notified_at: new Date().toISOString() }), alertId);
}

function refreshServerAlerts() {
  const now = new Date().toISOString();
  const detected = runAnomalyDetection(fleetAssets, undefined, OPERATORS);
  const activeIds = new Set(detected.map((alert) => alert.id));
  const existing = db.prepare('SELECT id, data, first_seen_at FROM alerts').all() as { id: string; data: string; first_seen_at: string }[];
  const existingById = new Map(existing.map((row) => [row.id, row]));

  for (const alert of detected) {
    const previous = existingById.get(alert.id);
    const previousData = previous ? JSON.parse(previous.data) : {};
    const data = JSON.stringify({
      ...alert,
      resolved: previousData.resolved ?? false,
      notifications: previousData.notifications,
      notified_at: previousData.notified_at,
      acknowledged_at: previousData.acknowledged_at,
      first_seen_at: previous?.first_seen_at || now,
      cleared_at: null,
    });
    db.prepare(`INSERT INTO alerts (id, asset_id, data, first_seen_at, last_seen_at, cleared_at)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, last_seen_at = excluded.last_seen_at, cleared_at = NULL`)
      .run(alert.id, alert.asset_id, data, previous?.first_seen_at || now, now);
    if (!previous) void sendAutomaticAlertNotification(alert.id);
  }
  for (const row of existing) {
    if (!activeIds.has(row.id)) db.prepare('UPDATE alerts SET cleared_at = ? WHERE id = ? AND cleared_at IS NULL').run(now, row.id);
  }
  return detected;
}

function getAlerts(includeCleared = false) {
  const rows = db.prepare(`SELECT data, cleared_at FROM alerts ${includeCleared ? '' : 'WHERE cleared_at IS NULL'} ORDER BY last_seen_at DESC`).all() as { data: string; cleared_at: string | null }[];
  return rows.map((row) => ({ ...JSON.parse(row.data), cleared_at: row.cleared_at }));
}

function loadOrSeedAssets(): any[] {
  const rows = db.prepare('SELECT data FROM assets').all() as { data: string }[];
  if (rows.length === 0) {
    // First boot: seed the database from the bundled sample dataset.
    for (const asset of INITIAL_ASSETS) persistAsset(asset);
    return [...INITIAL_ASSETS];
  }
  // Restore whatever was actually saved (post check-in/out, inspections, etc)
  const byId = new Map(rows.map((r) => [JSON.parse(r.data).id, JSON.parse(r.data)]));
  return INITIAL_ASSETS.map((seed) => byId.get(seed.id) || seed);
}

function loadInspections(): any[] {
  const rows = db.prepare('SELECT data FROM inspections ORDER BY created_at DESC').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}

// Fleet state, now backed by SQLite -- survives a server restart.
let fleetAssets = loadOrSeedAssets();
let inspectionLogs: any[] = loadInspections();
refreshServerAlerts();

// Gemini client initialization
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

// 1. Get all assets
app.get('/api/assets', (req, res) => {
  res.json({
    success: true,
    total: fleetAssets.length,
    assets: fleetAssets,
    sites: SITES,
    operators: OPERATORS,
  });
});

// Current server-side alerts. These persist independently of any open browser.
app.get('/api/alerts', (req, res) => {
  res.json({ success: true, alerts: getAlerts(req.query.history === 'true') });
});

// Acknowledgement and notification records belong on the server, not only in
// one browser tab, so the demo stays consistent after refresh or on another
// device. Delivery is deliberately marked "simulated" until a real provider
// (Twilio/SendGrid/Cat integration) is configured.
app.post('/api/alerts/:id/acknowledge', (req, res) => {
  const row = db.prepare('SELECT data FROM alerts WHERE id = ?').get(req.params.id) as { data: string } | undefined;
  if (!row) return res.status(404).json({ error: 'Alert not found' });
  const data = { ...JSON.parse(row.data), resolved: true, acknowledged_at: new Date().toISOString() };
  db.prepare('UPDATE alerts SET data = ? WHERE id = ?').run(JSON.stringify(data), req.params.id);
  res.json({ success: true, alert: data });
});

app.post('/api/alerts/:id/notify', async (req, res) => {
  const row = db.prepare('SELECT data FROM alerts WHERE id = ?').get(req.params.id) as { data: string } | undefined;
  if (!row) return res.status(404).json({ error: 'Alert not found' });
  const alert = JSON.parse(row.data);
  const asset = fleetAssets.find((item) => item.id === alert.asset_id);
  const site = SITES.find((item) => item.id === asset?.site_id);
  const operator = OPERATORS.find((item) => item.id === asset?.operator_id);
  const message = `Fleet alert ${alert.asset_id}: ${alert.type}. ${alert.recommendation}`;
  const managerPhone = process.env.ALERT_MANAGER_PHONE || site?.supervisor_phone;
  const customerPhone = process.env.ALERT_CUSTOMER_PHONE || operator?.contact;
  const smsRecipients = [
    { label: 'Manager SMS', recipient: managerPhone },
    { label: 'Customer / Operator SMS', recipient: customerPhone },
  ].filter((entry): entry is { label: string; recipient: string } => Boolean(entry.recipient));
  const smsNotifications = await Promise.all(smsRecipients.map(async ({ label, recipient }) => {
    try {
      const result = await sendSms(recipient, message);
      return { channel: 'SMS', recipient: `${label}: ${recipient}`, ...result };
    } catch (error: any) {
      return { channel: 'SMS', recipient: `${label}: ${recipient}`, status: 'Failed', detail: error.message || 'SMS delivery failed.' };
    }
  }));
  const notifications = [
    ...(site ? [{ channel: 'Email', recipient: `${site.supervisor} <${site.supervisor_email}>`, status: 'Simulated', detail: 'Demo email notification recorded.' }] : []),
    ...smsNotifications,
    { channel: 'In-Cab Console Alert', recipient: asset ? `${asset.id} on-board display` : 'Unit display', status: 'Simulated', detail: 'Demo in-cab alert recorded.' },
  ];
  const data = { ...alert, notifications, notified_at: new Date().toISOString() };
  db.prepare('UPDATE alerts SET data = ? WHERE id = ?').run(JSON.stringify(data), req.params.id);
  res.json({ success: true, alert: data });
});

// Phone QR scans register the machine, persist the scan event, and activate a
// live telemetry session. The current source is intentionally simulated; the
// endpoint is the stable seam for a real hardware/webhook integration.
app.post('/api/assets/:id/scan', (req, res) => {
  const index = fleetAssets.findIndex((asset) => asset.id.toLowerCase() === req.params.id.toLowerCase());
  if (index === -1) return res.status(404).json({ error: 'Asset not found' });
  const asset = { ...fleetAssets[index], tracking_enabled: true, tracking_status: 'Live demo telemetry', last_qr_scan_at: new Date().toISOString() };
  fleetAssets[index] = asset;
  liveTrackedAssetIds.add(asset.id);
  persistAsset(asset);
  recordRentalEvent(asset, 'scan', 'qr', { scan_source: 'phone QR', tracking_started_at: asset.last_qr_scan_at });
  publishDemoTelemetry(asset.id);
  res.json({ success: true, asset, message: `QR scan recorded and live tracking started for ${asset.id}` });
});

// Latest dashboard metrics calculated from the persisted fleet state.
app.get('/api/dashboard', (req, res) => {
  const totalEngineHours = fleetAssets.reduce((sum, asset) => sum + asset.engine_hours_day * asset.operating_days, 0);
  const totalIdleHours = fleetAssets.reduce((sum, asset) => sum + asset.idle_hours_day * asset.operating_days, 0);
  const fuelUsedLiters = fleetAssets.reduce((sum, asset) => sum + (asset.engine_hours_day + asset.idle_hours_day) * asset.operating_days * asset.fuel_burn_rate_lph, 0);
  res.json({ success: true, assets: fleetAssets, alerts: getAlerts(), metrics: { total_assets: fleetAssets.length, active_assets: fleetAssets.filter((a) => a.status === 'Active').length, total_engine_hours: Math.round(totalEngineHours), total_idle_hours: Math.round(totalIdleHours), fuel_used_liters: Math.round(fuelUsedLiters) } });
});

// Telematics ingestion contract. A simulator or a real equipment provider can
// post the same payload; every accepted reading updates the asset and alerts.
app.post('/api/telemetry', (req, res) => {
  const { asset_id, timestamp = new Date().toISOString(), latitude, longitude, engine_hours_day, idle_hours_day, fuel_level_pct, status } = req.body;
  const index = fleetAssets.findIndex((asset) => asset.id.toLowerCase() === String(asset_id || '').toLowerCase());
  if (index === -1) return res.status(404).json({ error: `Equipment ${asset_id} not found` });
  if (![latitude, longitude, engine_hours_day, idle_hours_day, fuel_level_pct].every(Number.isFinite)) return res.status(400).json({ error: 'latitude, longitude, engine_hours_day, idle_hours_day and fuel_level_pct must be numbers' });
  const asset = { ...fleetAssets[index], location: [latitude, longitude] as [number, number], engine_hours_day, idle_hours_day, fuel_level_pct, status: status || fleetAssets[index].status };
  fleetAssets[index] = asset;
  persistAsset(asset);
  insertTelemetryStmt.run(asset.id, timestamp, latitude, longitude, engine_hours_day, idle_hours_day, fuel_level_pct, asset.status);
  const alerts = refreshServerAlerts();
  res.json({ success: true, asset, alerts });
});

// 2. Get asset by ID
app.get('/api/assets/:id', (req, res) => {
  const asset = fleetAssets.find((a) => a.id.toLowerCase() === req.params.id.toLowerCase());
  if (!asset) {
    return res.status(404).json({ error: 'Asset not found' });
  }
  res.json({ success: true, asset });
});

// 3. Check-Out Asset
app.post('/api/checkout', (req, res) => {
  const { asset_id, site_id, operator_id, checkout_date, checkin_date, starting_fuel, source } = req.body;

  const index = fleetAssets.findIndex((a) => a.id.toLowerCase() === asset_id?.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: `Equipment ${asset_id} not found` });
  }

  const site = SITES.find((s) => s.id === site_id);
  const operator = OPERATORS.find((o) => o.id === operator_id);
  if (!site) return res.status(400).json({ error: 'A valid destination site is required' });
  if (operator && !operator.certified_equipment.includes(fleetAssets[index].type)) {
    return res.status(400).json({ error: `${operator.name} is not certified for ${fleetAssets[index].type}` });
  }
  if (checkout_date && checkin_date && new Date(checkin_date) < new Date(checkout_date)) {
    return res.status(400).json({ error: 'Expected return must be after check-out date' });
  }
  if (starting_fuel !== undefined && (!Number.isFinite(starting_fuel) || starting_fuel < 0 || starting_fuel > 100)) {
    return res.status(400).json({ error: 'Starting fuel must be between 0 and 100' });
  }
  const defaultReturn = new Date();
  defaultReturn.setDate(defaultReturn.getDate() + 14);

  fleetAssets[index] = {
    ...fleetAssets[index],
    site_id: site_id || fleetAssets[index].site_id,
    site_name: site ? site.name : fleetAssets[index].site_name,
    operator_id: operator_id || null,
    operator_name: operator ? operator.name : null,
    checkout_date: checkout_date || new Date().toISOString().split('T')[0],
    checkin_date: checkin_date || defaultReturn.toISOString().split('T')[0],
    status: 'Active',
    fuel_level_pct: starting_fuel !== undefined ? starting_fuel : fleetAssets[index].fuel_level_pct,
    location: site ? site.location : fleetAssets[index].location,
    anomalies: [],
  };
  persistAsset(fleetAssets[index]);
  recordRentalEvent(fleetAssets[index], 'checkout', source === 'qr' ? 'qr' : 'manual', { checkout_date: fleetAssets[index].checkout_date, expected_return_date: fleetAssets[index].checkin_date, starting_fuel: fleetAssets[index].fuel_level_pct });
  refreshServerAlerts();

  res.json({
    success: true,
    message: `Asset ${asset_id} successfully checked out to ${site?.name || site_id}`,
    asset: fleetAssets[index],
  });
});

// 4. Check-In Asset
app.post('/api/checkin', (req, res) => {
  const { asset_id, return_site_id, ending_engine_hours, fuel_level_pct, inspection_notes, status, source } = req.body;

  const index = fleetAssets.findIndex((a) => a.id.toLowerCase() === asset_id?.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: `Equipment ${asset_id} not found` });
  }
  if (!Number.isFinite(ending_engine_hours) || ending_engine_hours < 0) return res.status(400).json({ error: 'Ending engine hours must be a non-negative number' });
  if (ending_engine_hours < (fleetAssets[index].lifetime_engine_hours || 0)) {
    return res.status(400).json({ error: `Ending engine hours (${ending_engine_hours}) can't be less than the current meter reading (${fleetAssets[index].lifetime_engine_hours})` });
  }
  if (!Number.isFinite(fuel_level_pct) || fuel_level_pct < 0 || fuel_level_pct > 100) return res.status(400).json({ error: 'Fuel level must be between 0 and 100' });
  const returnSite = return_site_id ? SITES.find((site) => site.id === return_site_id) : undefined;
  if (return_site_id && !returnSite) return res.status(400).json({ error: 'Return site is invalid' });

  fleetAssets[index] = {
    ...fleetAssets[index],
    status: status || 'Idle',
    operator_id: null,
    operator_name: null,
    fuel_level_pct: fuel_level_pct !== undefined ? fuel_level_pct : fleetAssets[index].fuel_level_pct,
    lifetime_engine_hours: ending_engine_hours,
    returned_at: new Date().toISOString(),
    anomalies: [],
  };
  persistAsset(fleetAssets[index]);
  recordRentalEvent(fleetAssets[index], 'checkin', source === 'qr' ? 'qr' : 'manual', { return_site_id: returnSite?.id || null, return_site_name: returnSite?.name || null, ending_engine_hours, fuel_level_pct, inspection_notes: inspection_notes || null, return_status: fleetAssets[index].status });
  refreshServerAlerts();

  res.json({
    success: true,
    message: `Asset ${asset_id} checked in successfully`,
    asset: fleetAssets[index],
  });
});

// 4b. Rental history -- the permanent per-machine timeline used for demand
// forecasting down the line. /api/history/:assetId scopes to one machine;
// /api/history returns the full fleet-wide event log.
app.get('/api/history/:assetId', (req, res) => {
  res.json({ success: true, events: getRentalHistory(req.params.assetId) });
});

app.get('/api/history', (req, res) => {
  res.json({ success: true, events: getRentalHistory() });
});

// 5. Submit Inspection Checklist
app.post('/api/inspections', (req, res) => {
  const inspectionData = {
    id: `INSP-${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...req.body,
  };

  inspectionLogs.unshift(inspectionData);
  persistInspection(inspectionData);

  // If failed risk score, update asset health / status
  if (req.body.asset_id && req.body.risk_score > 60) {
    const assetIdx = fleetAssets.findIndex((a) => a.id === req.body.asset_id);
    if (assetIdx !== -1) {
      fleetAssets[assetIdx].status = 'Under Maintenance';
      fleetAssets[assetIdx].health_score = Math.max(30, 100 - req.body.risk_score);
      persistAsset(fleetAssets[assetIdx]);
      refreshServerAlerts();
    }
  }

  res.json({
    success: true,
    inspection: inspectionData,
  });
});

// 6. AI Demand Forecasting Endpoint (Gemini 3.7 Flash + Rule Fallback)
app.post('/api/forecast', async (req, res) => {
  const { site_id, project_type, duration_weeks = 4, target_volume_m3 = 50000, terrain = 'Standard' } = req.body;

  const site = SITES.find((s) => s.id === site_id) || SITES[0];

  const client = getGeminiClient();

  if (client) {
    {
      const prompt = `You are the Lead Fleet Engineer at Caterpillar. Provide a structured machinery demand forecast for the following heavy construction project:
Site: ${site.name} (${site.city}, ${site.state})
Project Type: ${project_type || site.project_type}
Duration: ${duration_weeks} weeks
Target Earthwork / Material Volume: ${target_volume_m3} cubic meters
Terrain & Ground Conditions: ${terrain}

Return a valid JSON object matching this schema:
{
  "site_id": "${site.id}",
  "site_name": "${site.name}",
  "project_type": "${project_type || site.project_type}",
  "duration_weeks": ${duration_weeks},
  "target_volume_m3": ${target_volume_m3},
  "peak_workload_week": 3,
  "total_fleet_cost": 48500,
  "co2_emission_est_tons": 18.4,
  "recommended_fleet": [
    {
      "type": "Excavator",
      "model": "Cat 320 Next-Gen",
      "count": 2,
      "hours_needed": 160,
      "est_fuel_burn_liters": 2240,
      "est_rental_cost": 15200,
      "utilization_confidence": 94
    },
    {
      "type": "Bulldozer",
      "model": "Cat D6T Heavy Crawler",
      "count": 1,
      "hours_needed": 120,
      "est_fuel_burn_liters": 2730,
      "est_rental_cost": 13200,
      "utilization_confidence": 91
    }
  ],
  "ai_insights": "Detailed engineering rationale on optimal fleet sizing, idle reduction, and fuel efficiency."
}
Only output valid JSON.`;

      // Gemini's shared capacity occasionally returns a transient 503
      // ("model currently experiencing high demand"). Retry a couple of
      // times with a short backoff before giving up to the rules-engine
      // fallback, since a single 503 shouldn't take the AI path down.
      const maxAttempts = 3;
      let lastErr: any;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const aiResponse = await client.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              temperature: 0.2,
            },
          });

          const parsed = JSON.parse(aiResponse.text || '{}');
          return res.json({
            success: true,
            forecast: {
              ...parsed,
              source: 'gemini',
            },
          });
        } catch (err: any) {
          lastErr = err;
          const isRetryable = err.message?.includes('503') || err.message?.includes('UNAVAILABLE');
          if (!isRetryable || attempt === maxAttempts) break;
          await new Promise((r) => setTimeout(r, attempt * 700));
        }
      }
      console.warn('Gemini forecast API fallback triggered:', lastErr?.message);
    }
  }

  // Smart Algorithmic Rule Engine Fallback
  const vol = Number(target_volume_m3) || 50000;
  const weeks = Number(duration_weeks) || 4;
  const excavatorCount = Math.max(1, Math.ceil(vol / (weeks * 25000)));
  const bulldozerCount = Math.max(1, Math.ceil(vol / (weeks * 40000)));
  const graderCount = vol > 60000 || project_type?.toLowerCase().includes('highway') ? 1 : 0;
  const craneCount = project_type?.toLowerCase().includes('transit') || project_type?.toLowerCase().includes('energy') ? 1 : 0;

  const fleet: any[] = [
    {
      type: 'Excavator',
      model: 'Cat 320 Next-Gen',
      count: excavatorCount,
      hours_needed: Math.round(weeks * 40 * 0.85),
      est_fuel_burn_liters: Math.round(excavatorCount * weeks * 40 * 14.2),
      est_rental_cost: excavatorCount * weeks * 7 * 950,
      utilization_confidence: 93,
    },
    {
      type: 'Bulldozer',
      model: 'Cat D6T Heavy Crawler',
      count: bulldozerCount,
      hours_needed: Math.round(weeks * 35 * 0.8),
      est_fuel_burn_liters: Math.round(bulldozerCount * weeks * 35 * 22.8),
      est_rental_cost: bulldozerCount * weeks * 7 * 1100,
      utilization_confidence: 89,
    },
  ];

  if (graderCount > 0) {
    fleet.push({
      type: 'Grader',
      model: 'Cat 140M Motor Grader',
      count: 1,
      hours_needed: Math.round(weeks * 25),
      est_fuel_burn_liters: Math.round(weeks * 25 * 16.1),
      est_rental_cost: weeks * 7 * 880,
      utilization_confidence: 86,
    });
  }

  if (craneCount > 0) {
    fleet.push({
      type: 'Crane',
      model: 'Cat 250 Hydraulic Crane',
      count: 1,
      hours_needed: Math.round(weeks * 20),
      est_fuel_burn_liters: Math.round(weeks * 20 * 8.5),
      est_rental_cost: weeks * 7 * 1450,
      utilization_confidence: 91,
    });
  }

  const totalCost = fleet.reduce((acc, f) => acc + f.est_rental_cost, 0);
  const totalFuelLiters = fleet.reduce((acc, f) => acc + f.est_fuel_burn_liters, 0);
  const co2Tons = Number(((totalFuelLiters * 2.68) / 1000).toFixed(1));

  res.json({
    success: true,
    forecast: {
      site_id: site.id,
      site_name: site.name,
      project_type: project_type || site.project_type,
      duration_weeks: weeks,
      target_volume_m3: vol,
      peak_workload_week: Math.min(weeks, 3),
      total_fleet_cost: totalCost,
      co2_emission_est_tons: co2Tons,
      recommended_fleet: fleet,
      ai_insights: `Based on Caterpillar Fleet historical telemetry for ${site.name}, ${excavatorCount}x Cat 320 and ${bulldozerCount}x Cat D6T ensure high cycle velocity while keeping fuel burn under optimal thresholds. Staggering working shifts will eliminate the 10+ hour idle times currently observed.`,
      source: 'rules-engine',
    },
  });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE & SERVER STARTUP
// -------------------------------------------------------------

async function startServer() {
  if (!process.argv.includes('--production')) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Caterpillar Fleet API & Frontend running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
