import express from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { INITIAL_ASSETS, SITES, OPERATORS } from './src/data/initialAssets.ts';
import { runAnomalyDetection } from './src/utils/anomalyDetector.ts';
import { haversineDistanceMeters } from './src/utils/geo.ts';
import { generateOptimizationRecommendations } from './src/services/fleetOptimizer.ts';
import { buildFleetContext } from './src/services/fleetContext.ts';
import { getAiProvider } from './src/services/aiProvider.ts';
import { BUSINESS_RULES } from './src/config/businessRules.ts';
import type { GeofenceEvent, GeofenceStatus, OptimizationRecommendation } from './src/types.ts';

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
//
// The DB file lives outside the project folder entirely (not just outside
// dist/), in the user's home directory. It used to sit at <project>/fleet.db,
// but the live telemetry simulator rewrites it every 5s, and Vite's dev
// server watches the whole project root for its own .env/config-restart
// logic -- that write churn was tripping false-positive "*.env changed*"
// detections on Windows, restarting the Vite server in a tight 5s loop and
// killing the page's live connection continuously. Keeping runtime state
// fully outside the watched tree removes the false trigger at the source.
const dataDir = path.join(os.homedir(), '.rental-assets-tracking');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'fleet.db'));

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
  CREATE TABLE IF NOT EXISTS geofences (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    radius_meters REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS geofence_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL,
    geofence_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    status TEXT NOT NULL,
    distance_m REAL NOT NULL,
    severity TEXT NOT NULL,
    violation_started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    violation_count INTEGER NOT NULL DEFAULT 1,
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS optimization_recommendations (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
`);

// Lightweight forward migration for databases created before rental-event
// handover details were captured. Keeping it here makes an existing demo DB
// upgrade safely on restart rather than requiring anyone to delete data.
const rentalEventColumns = db.prepare('PRAGMA table_info(rental_events)').all() as { name: string }[];
if (!rentalEventColumns.some((column) => column.name === 'details')) {
  db.exec('ALTER TABLE rental_events ADD COLUMN details TEXT');
}

// Seed one default geofence per known site on first boot (2km radius, per
// BUSINESS_RULES.defaultGeofenceRadiusMeters). Managers can edit/replace
// these via the geofence CRUD API below; this only fills the gap so every
// site has *some* boundary from the moment the app starts.
const existingGeofenceCount = (db.prepare('SELECT COUNT(*) as c FROM geofences').get() as { c: number }).c;
if (existingGeofenceCount === 0) {
  const insertGeofence = db.prepare(
    'INSERT INTO geofences (id, site_id, name, latitude, longitude, radius_meters, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
  );
  const now = new Date().toISOString();
  for (const site of SITES) {
    insertGeofence.run(`GF-${site.id}`, site.id, `${site.name} Operating Boundary`, site.location[0], site.location[1], BUSINESS_RULES.defaultGeofenceRadiusMeters, now, now);
  }
}

function getGeofences() {
  return (db.prepare('SELECT * FROM geofences ORDER BY site_id').all() as any[]).map((row) => ({ ...row, active: Boolean(row.active) }));
}

function getActiveGeofenceForSite(siteId: string) {
  const row = db.prepare('SELECT * FROM geofences WHERE site_id = ? AND active = 1 ORDER BY updated_at DESC LIMIT 1').get(siteId) as any;
  return row ? { ...row, active: Boolean(row.active) } : undefined;
}

function classifyGeofenceStatus(distanceM: number, radiusM: number): GeofenceStatus {
  if (distanceM <= radiusM * BUSINESS_RULES.nearBoundaryRatio) return 'INSIDE';
  if (distanceM <= radiusM) return 'NEAR_BOUNDARY';
  return 'OUTSIDE';
}

/**
 * Evaluates one asset's live position against its assigned site's geofence
 * and updates the open/closed violation incident in geofence_events.
 * Deliberately does NOT create a new alert on every telemetry tick -- a
 * violation incident is opened once when status first becomes OUTSIDE, then
 * only its last_seen_at/violation_count/distance are updated on each
 * subsequent tick, and it's closed (resolved_at set) once the asset returns
 * inside the boundary. This is what keeps geofence alerts from spamming.
 */
function evaluateGeofence(asset: any): { status: GeofenceStatus; distance_m: number } {
  if (!asset.site_id) return { status: 'UNKNOWN', distance_m: 0 };
  const geofence = getActiveGeofenceForSite(asset.site_id);
  if (!geofence) return { status: 'UNKNOWN', distance_m: 0 };

  const distance = haversineDistanceMeters(asset.location, [geofence.latitude, geofence.longitude]);
  const status = classifyGeofenceStatus(distance, geofence.radius_meters);
  const now = new Date().toISOString();

  const openEvent = db
    .prepare('SELECT * FROM geofence_events WHERE asset_id = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(asset.id) as any;

  if (status === 'OUTSIDE') {
    const severity = distance - geofence.radius_meters >= BUSINESS_RULES.geofenceCriticalOverageMeters ? 'CRITICAL' : 'WARNING';
    if (openEvent && openEvent.geofence_id === geofence.id) {
      db.prepare('UPDATE geofence_events SET distance_m = ?, severity = ?, last_seen_at = ?, violation_count = violation_count + 1 WHERE id = ?')
        .run(distance, severity, now, openEvent.id);
    } else {
      if (openEvent) db.prepare('UPDATE geofence_events SET resolved_at = ? WHERE id = ?').run(now, openEvent.id);
      db.prepare(
        'INSERT INTO geofence_events (asset_id, geofence_id, site_id, status, distance_m, severity, violation_started_at, last_seen_at, violation_count, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)'
      ).run(asset.id, geofence.id, asset.site_id, status, distance, severity, now, now);
    }
  } else if (openEvent) {
    db.prepare('UPDATE geofence_events SET resolved_at = ? WHERE id = ?').run(now, openEvent.id);
  }

  return { status, distance_m: Math.round(distance) };
}

function getOpenGeofenceEvents(): GeofenceEvent[] {
  return db.prepare('SELECT * FROM geofence_events WHERE resolved_at IS NULL ORDER BY violation_started_at DESC').all() as unknown as GeofenceEvent[];
}

function getGeofenceEvents(assetId?: string): GeofenceEvent[] {
  const rows = assetId
    ? db.prepare('SELECT * FROM geofence_events WHERE asset_id = ? ORDER BY id DESC').all(assetId)
    : db.prepare('SELECT * FROM geofence_events ORDER BY id DESC LIMIT 200').all();
  return rows as unknown as GeofenceEvent[];
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

// Assets currently under a "Simulate Geofence Violation" demo drift -- each
// tick nudges them further outside their assigned site's boundary instead of
// randomly, so the demo control produces a real, visible OUTSIDE reading
// within a couple of telemetry ticks instead of relying on chance.
const geofenceDriftAssetIds = new Set<string>();

// This is a deliberate demo telemetry source. A real deployment replaces this
// loop with authenticated Product Link/VisionLink webhooks, but QR scanning
// immediately creates the same persisted tracking session and live UI effect.
function publishDemoTelemetry(assetId: string) {
  const index = fleetAssets.findIndex((asset) => asset.id === assetId);
  if (index === -1) return;
  const current = fleetAssets[index];
  const working = current.status === 'Active';
  const drifting = geofenceDriftAssetIds.has(assetId);
  const location: [number, number] = drifting
    ? [current.location[0] + 0.006, current.location[1] + 0.006]
    : [current.location[0] + (Math.random() - 0.5) * 0.002, current.location[1] + (Math.random() - 0.5) * 0.002];
  const asset = {
    ...current,
    location,
    engine_hours_day: Number((current.engine_hours_day + (working ? 0.1 : 0)).toFixed(1)),
    idle_hours_day: Number((current.idle_hours_day + (working ? 0 : 0.1)).toFixed(1)),
    fuel_level_pct: Number(Math.max(0, current.fuel_level_pct - (working ? 0.2 : 0.03)).toFixed(1)),
    tracking_enabled: true,
    tracking_status: 'Live demo telemetry',
    last_telemetry_at: new Date().toISOString(),
  };
  const geofence = evaluateGeofence(asset);
  asset.geofence_status = geofence.status;
  asset.geofence_distance_m = geofence.distance_m;
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

let cachedSmtpTransport: nodemailer.Transporter | null | undefined;

function getSmtpTransport(): nodemailer.Transporter | null {
  if (cachedSmtpTransport !== undefined) return cachedSmtpTransport;
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port || !user || !pass) {
    cachedSmtpTransport = null;
    return null;
  }
  cachedSmtpTransport = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });
  return cachedSmtpTransport;
}

// Mirrors sendSms()'s real-if-configured / simulated-otherwise contract, so
// email and SMS behave identically instead of email being unconditionally
// fake. Configure SMTP_HOST/PORT/USER/PASS to actually deliver mail.
async function sendEmail(to: string, subject: string, body: string) {
  const transport = getSmtpTransport();
  if (!transport) {
    return { status: 'Simulated' as const, detail: 'Add SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS to send this email for real.' };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const info = await transport.sendMail({ from, to, subject, text: body });
  return { status: 'Sent' as const, detail: `Email ${info.messageId} accepted for delivery to ${to}.` };
}

// Every alert has up to three distinct real-world recipients -- distinct
// contact records pulled from actual asset/site/operator data, not a single
// blurred "notify someone" call:
//  - Manager: fleet-wide, from ALERT_MANAGER_PHONE/EMAIL env config (no
//    single "manager" entity exists in the data model, so this is
//    operator-configured, same as a real ops team would set up).
//  - Site Supervisor: per-site contact from SITES (site.supervisor_*).
//  - Customer / Operator: whoever currently has the unit checked out
//    (OPERATORS[].contact) -- this app models the person operating the
//    rented equipment, which doubles as "the customer" for this rental.
function resolveAlertRecipients(asset: any) {
  const site = SITES.find((s) => s.id === asset?.site_id);
  const operator = OPERATORS.find((o) => o.id === asset?.operator_id);
  const recipients: { role: 'Manager' | 'Site Supervisor' | 'Customer / Operator'; phone?: string; email?: string }[] = [];
  const managerPhone = process.env.ALERT_MANAGER_PHONE;
  const managerEmail = process.env.ALERT_MANAGER_EMAIL;
  if (managerPhone || managerEmail) recipients.push({ role: 'Manager', phone: managerPhone, email: managerEmail });
  if (site) recipients.push({ role: 'Site Supervisor', phone: site.supervisor_phone, email: site.supervisor_email });
  if (operator) recipients.push({ role: 'Customer / Operator', phone: process.env.ALERT_CUSTOMER_PHONE || operator.contact });
  return recipients;
}

async function dispatchAlertNotifications(alert: any, asset: any) {
  const message = `Fleet alert ${alert.asset_id}: ${alert.type}. ${alert.recommendation}`;
  const recipients = resolveAlertRecipients(asset);
  const notifications = (await Promise.all(recipients.flatMap((r) => {
    const tasks: Promise<any>[] = [];
    if (r.phone) {
      tasks.push(sendSms(r.phone, message)
        .then((result) => ({ channel: 'SMS', role: r.role, recipient: r.phone, ...result }))
        .catch((error: any) => ({ channel: 'SMS', role: r.role, recipient: r.phone, status: 'Failed', detail: error.message || 'SMS delivery failed.' })));
    }
    if (r.email) {
      tasks.push(sendEmail(r.email, `Fleet Alert: ${alert.type} on ${alert.asset_id}`, `${message}\n\nAsset: ${alert.asset_id}\nSeverity: ${alert.severity}\nDescription: ${alert.description}`)
        .then((result) => ({ channel: 'Email', role: r.role, recipient: r.email, ...result }))
        .catch((error: any) => ({ channel: 'Email', role: r.role, recipient: r.email, status: 'Failed', detail: error.message || 'Email delivery failed.' })));
    }
    return tasks;
  }))) as any[];
  notifications.push({
    channel: 'In-Cab Console Alert',
    role: 'Operator',
    recipient: asset ? `${asset.id} on-board display` : 'Unit display',
    status: 'Simulated',
    detail: 'No real in-cab telematics hardware is connected in this demo; a production deployment would push this over Cat Product Link / VisionLink.',
  });
  return notifications;
}

async function sendAutomaticAlertNotification(alertId: string) {
  const row = db.prepare('SELECT data FROM alerts WHERE id = ?').get(alertId) as { data: string } | undefined;
  if (!row) return;
  const alert = JSON.parse(row.data);
  const asset = fleetAssets.find((item) => item.id === alert.asset_id);
  const notifications = await dispatchAlertNotifications(alert, asset);
  const latest = db.prepare('SELECT data FROM alerts WHERE id = ?').get(alertId) as { data: string } | undefined;
  if (!latest) return;
  db.prepare('UPDATE alerts SET data = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(latest.data), notifications, notified_at: new Date().toISOString() }), alertId);
}

// Turns each currently-open geofence violation incident into an AnomalyAlert
// so it flows through the same acknowledge/notify/history pipeline as every
// other alert type. One alert per open incident (not per telemetry tick) --
// evaluateGeofence() already collapses repeat ticks into a single incident.
function geofenceViolationAlerts(): any[] {
  const openEvents = getOpenGeofenceEvents();
  return openEvents.map((event) => {
    const asset = fleetAssets.find((a) => a.id === event.asset_id);
    const site = SITES.find((s) => s.id === event.site_id);
    const distanceKm = (event.distance_m / 1000).toFixed(1);
    return {
      id: `ANOM-GEO-${event.asset_id}`,
      asset_id: event.asset_id,
      type: 'Geofence Violation',
      severity: event.severity === 'CRITICAL' ? 'Critical' : 'Warning',
      description: `${event.asset_id} has left the ${site?.name || event.site_id} geofence by ${distanceKm} km.`,
      metric_value: `${distanceKm} km outside boundary`,
      recommendation: asset?.status === 'Active'
        ? 'Confirm the unit is authorized to be off-site, or dispatch a return-to-boundary instruction to the operator.'
        : 'This unit has no active rental but is reporting movement outside its last assigned site — verify it has not been moved without authorization.',
      timestamp: 'Geofence Rule Trigger',
      resolved: false,
    };
  });
}

function refreshServerAlerts() {
  const now = new Date().toISOString();
  const detected = [...runAnomalyDetection(fleetAssets, undefined, OPERATORS), ...geofenceViolationAlerts()];
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
// Evaluate geofence status for every asset immediately on boot, so the map
// and dashboard show a real INSIDE/OUTSIDE reading from the first request
// instead of waiting for the first 5s telemetry tick.
fleetAssets = fleetAssets.map((asset) => {
  const geofence = evaluateGeofence(asset);
  const next = { ...asset, geofence_status: geofence.status, geofence_distance_m: geofence.distance_m };
  persistAsset(next);
  return next;
});
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
  const notifications = await dispatchAlertNotifications(alert, asset);
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
  const asset: any = { ...fleetAssets[index], location: [latitude, longitude] as [number, number], engine_hours_day, idle_hours_day, fuel_level_pct, status: status || fleetAssets[index].status };
  const geofence = evaluateGeofence(asset);
  asset.geofence_status = geofence.status;
  asset.geofence_distance_m = geofence.distance_m;
  fleetAssets[index] = asset;
  persistAsset(asset);
  insertTelemetryStmt.run(asset.id, timestamp, latitude, longitude, engine_hours_day, idle_hours_day, fuel_level_pct, asset.status);
  const alerts = refreshServerAlerts();
  res.json({ success: true, asset, alerts });
});

// Live per-asset telemetry helpers -- the same persisted stream that backs
// publishDemoTelemetry()/POST /api/telemetry, exposed for the frontend and
// any future real telematics dashboard.
app.get('/api/assets/:id/telemetry', (req, res) => {
  const rows = db.prepare('SELECT * FROM telemetry_readings WHERE asset_id = ? ORDER BY id DESC LIMIT 200').all(req.params.id);
  res.json({ success: true, readings: rows });
});

app.get('/api/assets/:id/telemetry/latest', (req, res) => {
  const row = db.prepare('SELECT * FROM telemetry_readings WHERE asset_id = ? ORDER BY id DESC LIMIT 1').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No telemetry recorded for this asset yet' });
  res.json({ success: true, reading: row });
});

app.get('/api/assets/:id/usage', (req, res) => {
  const asset = fleetAssets.find((a) => a.id.toLowerCase() === req.params.id.toLowerCase());
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  const readingCount = (db.prepare('SELECT COUNT(*) as c FROM telemetry_readings WHERE asset_id = ?').get(asset.id) as { c: number }).c;
  res.json({
    success: true,
    usage: {
      asset_id: asset.id,
      engine_hours_day: asset.engine_hours_day,
      idle_hours_day: asset.idle_hours_day,
      lifetime_engine_hours: asset.lifetime_engine_hours,
      operating_days: asset.operating_days,
      utilization_pct: Math.round((asset.engine_hours_day / Math.max(asset.engine_hours_day + asset.idle_hours_day, 0.1)) * 100),
      telemetry_reading_count: readingCount,
    },
  });
});

app.get('/api/sites/:id/usage', (req, res) => {
  const site = SITES.find((s) => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  const siteAssets = fleetAssets.filter((a) => a.site_id === site.id);
  const totalEngine = siteAssets.reduce((sum, a) => sum + a.engine_hours_day * a.operating_days, 0);
  const totalIdle = siteAssets.reduce((sum, a) => sum + a.idle_hours_day * a.operating_days, 0);
  res.json({
    success: true,
    usage: {
      site_id: site.id,
      site_name: site.name,
      asset_count: siteAssets.length,
      active_count: siteAssets.filter((a) => a.status === 'Active').length,
      total_engine_hours: Math.round(totalEngine),
      total_idle_hours: Math.round(totalIdle),
      utilization_pct: Math.round((totalEngine / Math.max(totalEngine + totalIdle, 1)) * 100),
    },
  });
});

// Real historical trend for the Analytics screen, computed from actual
// persisted telemetry_readings rows (not a fabricated series). Buckets by
// hour so the chart is meaningful within a single demo session; returns
// whatever real history actually exists, which may be sparse right after
// a fresh install -- that's shown honestly rather than backfilled with
// invented data.
app.get('/api/telemetry/fleet-history', (req, res) => {
  const rows = db.prepare('SELECT timestamp, engine_hours_day, idle_hours_day, fuel_level_pct FROM telemetry_readings ORDER BY timestamp ASC').all() as {
    timestamp: string; engine_hours_day: number; idle_hours_day: number; fuel_level_pct: number;
  }[];
  const buckets = new Map<string, { engine: number; idle: number; fuel: number; count: number }>();
  for (const row of rows) {
    const bucketKey = row.timestamp.slice(0, 13); // YYYY-MM-DDTHH
    const bucket = buckets.get(bucketKey) || { engine: 0, idle: 0, fuel: 0, count: 0 };
    bucket.engine += row.engine_hours_day;
    bucket.idle += row.idle_hours_day;
    bucket.fuel += row.fuel_level_pct;
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
  }
  const series = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24)
    .map(([key, b]) => ({
      label: `${key.slice(11, 13)}:00`,
      timestamp: key,
      avg_idle_pct: Math.round((b.idle / Math.max(b.engine + b.idle, 0.1)) * 100),
      avg_fuel_pct: Math.round(b.fuel / b.count),
      reading_count: b.count,
    }));
  res.json({ success: true, buckets: series, total_readings: rows.length });
});

app.get('/api/telemetry/summary', (req, res) => {
  const totalReadings = (db.prepare('SELECT COUNT(*) as c FROM telemetry_readings').get() as { c: number }).c;
  const latestPerAsset = fleetAssets.map((a) => ({ asset_id: a.id, last_telemetry_at: a.last_telemetry_at || null, tracking_enabled: Boolean(a.tracking_enabled), geofence_status: a.geofence_status || 'UNKNOWN' }));
  res.json({ success: true, total_readings: totalReadings, assets: latestPerAsset });
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
// GEOFENCING
// -------------------------------------------------------------

app.get('/api/geofences', (req, res) => {
  res.json({ success: true, geofences: getGeofences() });
});

app.get('/api/geofences/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM geofences WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Geofence not found' });
  res.json({ success: true, geofence: { ...row, active: Boolean(row.active) } });
});

app.post('/api/geofences', (req, res) => {
  const { site_id, name, latitude, longitude, radius_meters, active = true } = req.body;
  const site = SITES.find((s) => s.id === site_id);
  if (!site) return res.status(400).json({ error: 'A valid site_id is required' });
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
  if (![latitude, longitude, radius_meters].every(Number.isFinite) || radius_meters <= 0) {
    return res.status(400).json({ error: 'latitude, longitude must be numbers and radius_meters must be a positive number' });
  }
  const id = `GF-${site_id}-${Date.now()}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO geofences (id, site_id, name, latitude, longitude, radius_meters, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, site_id, name, latitude, longitude, radius_meters, active ? 1 : 0, now, now);
  res.status(201).json({ success: true, geofence: { id, site_id, name, latitude, longitude, radius_meters, active, created_at: now, updated_at: now } });
});

app.put('/api/geofences/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM geofences WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Geofence not found' });
  const { name = existing.name, latitude = existing.latitude, longitude = existing.longitude, radius_meters = existing.radius_meters, active = Boolean(existing.active) } = req.body;
  if (![latitude, longitude, radius_meters].every(Number.isFinite) || radius_meters <= 0) {
    return res.status(400).json({ error: 'latitude, longitude must be numbers and radius_meters must be a positive number' });
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE geofences SET name = ?, latitude = ?, longitude = ?, radius_meters = ?, active = ?, updated_at = ? WHERE id = ?')
    .run(name, latitude, longitude, radius_meters, active ? 1 : 0, now, req.params.id);
  res.json({ success: true, geofence: { ...existing, name, latitude, longitude, radius_meters, active, updated_at: now } });
});

app.delete('/api/geofences/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM geofences WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Geofence not found' });
  db.prepare('DELETE FROM geofences WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/geofence-events', (req, res) => {
  const assetId = typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined;
  res.json({ success: true, events: getGeofenceEvents(assetId), open_count: getOpenGeofenceEvents().length });
});

// -------------------------------------------------------------
// SMART FLEET OPTIMIZATION & DISPATCH ENGINE
// -------------------------------------------------------------

function computeAndPersistRecommendations(): OptimizationRecommendation[] {
  const draft = generateOptimizationRecommendations({ assets: fleetAssets, sites: SITES, operators: OPERATORS });
  const now = new Date().toISOString();
  for (const rec of draft) {
    // Deterministic id from what the recommendation actually is, so a fresh
    // computation on an unchanged fleet state updates the same row instead of
    // creating a duplicate pending card every time the dashboard polls.
    const id = `OPT-${rec.type}-${rec.asset_id}-${rec.to_site || 'NA'}`;
    const existing = db.prepare('SELECT id, decision FROM optimization_recommendations WHERE id = ?').get(id) as { id: string; decision: string } | undefined;
    if (existing && existing.decision !== 'PENDING') continue; // don't resurrect a decided recommendation
    if (existing) {
      db.prepare('UPDATE optimization_recommendations SET data = ? WHERE id = ?').run(JSON.stringify({ ...rec, id }), id);
    } else {
      db.prepare('INSERT INTO optimization_recommendations (id, data, decision, created_at, decided_at) VALUES (?, ?, ?, ?, NULL)')
        .run(id, JSON.stringify({ ...rec, id }), 'PENDING', now);
    }
  }
  return getRecommendations();
}

function getRecommendations(includeDecided = true): OptimizationRecommendation[] {
  const rows = db.prepare(`SELECT data, decision, created_at, decided_at FROM optimization_recommendations ${includeDecided ? '' : "WHERE decision = 'PENDING'"} ORDER BY created_at DESC LIMIT 100`).all() as any[];
  return rows.map((row) => ({ ...JSON.parse(row.data), decision: row.decision, created_at: row.created_at, decided_at: row.decided_at }));
}

app.get('/api/optimization/recommendations', (req, res) => {
  const recommendations = computeAndPersistRecommendations();
  res.json({ success: true, recommendations });
});

app.post('/api/optimization/recommendations/:id/accept', (req, res) => {
  const row = db.prepare('SELECT data, decision FROM optimization_recommendations WHERE id = ?').get(req.params.id) as { data: string; decision: string } | undefined;
  if (!row) return res.status(404).json({ error: 'Recommendation not found' });
  if (row.decision !== 'PENDING') return res.status(409).json({ error: `Recommendation already ${row.decision.toLowerCase()}` });
  const rec: OptimizationRecommendation = JSON.parse(row.data);
  const index = fleetAssets.findIndex((a) => a.id === rec.asset_id);
  if (index === -1) return res.status(404).json({ error: `Equipment ${rec.asset_id} not found` });

  if (rec.type === 'RELOCATE_ASSET') {
    const targetSite = SITES.find((s) => s.id === rec.to_site);
    if (!targetSite) return res.status(400).json({ error: 'Destination site no longer exists' });
    const operator = rec.operator_id ? OPERATORS.find((o) => o.id === rec.operator_id) : undefined;
    fleetAssets[index] = {
      ...fleetAssets[index],
      site_id: targetSite.id,
      site_name: targetSite.name,
      location: targetSite.location,
      operator_id: operator?.id || fleetAssets[index].operator_id,
      operator_name: operator?.name || fleetAssets[index].operator_name,
    };
    recordRentalEvent(fleetAssets[index], 'checkout', 'manual', { relocation: true, from_site: rec.from_site, to_site: rec.to_site, optimization_id: rec.id });
  } else if (rec.type === 'RETURN_EARLY') {
    fleetAssets[index] = { ...fleetAssets[index], status: 'Idle', operator_id: null, operator_name: null, returned_at: new Date().toISOString() };
    recordRentalEvent(fleetAssets[index], 'checkin', 'manual', { early_return: true, optimization_id: rec.id });
  } else if (rec.type === 'ASSIGN_OPERATOR') {
    const operator = rec.operator_id ? OPERATORS.find((o) => o.id === rec.operator_id) : undefined;
    if (!operator) return res.status(400).json({ error: 'Recommended operator no longer available' });
    fleetAssets[index] = { ...fleetAssets[index], operator_id: operator.id, operator_name: operator.name };
    recordRentalEvent(fleetAssets[index], 'checkout', 'manual', { operator_assignment: true, optimization_id: rec.id });
  }

  persistAsset(fleetAssets[index]);
  const now = new Date().toISOString();
  db.prepare('UPDATE optimization_recommendations SET decision = ?, decided_at = ? WHERE id = ?').run('ACCEPTED', now, rec.id);
  refreshServerAlerts();
  res.json({ success: true, asset: fleetAssets[index], recommendation: { ...rec, decision: 'ACCEPTED', decided_at: now } });
});

app.post('/api/optimization/recommendations/:id/dismiss', (req, res) => {
  const row = db.prepare('SELECT decision FROM optimization_recommendations WHERE id = ?').get(req.params.id) as { decision: string } | undefined;
  if (!row) return res.status(404).json({ error: 'Recommendation not found' });
  if (row.decision !== 'PENDING') return res.status(409).json({ error: `Recommendation already ${row.decision.toLowerCase()}` });
  const now = new Date().toISOString();
  db.prepare('UPDATE optimization_recommendations SET decision = ?, decided_at = ? WHERE id = ?').run('DISMISSED', now, req.params.id);
  res.json({ success: true });
});

// -------------------------------------------------------------
// AI COPILOT
// -------------------------------------------------------------

app.get('/api/ai/context', (req, res) => {
  const context = buildFleetContext({
    assets: fleetAssets,
    sites: SITES,
    operators: OPERATORS,
    alerts: getAlerts() as any,
    openGeofenceEvents: getOpenGeofenceEvents(),
    recommendations: getRecommendations(),
  });
  res.json({ success: true, context });
});

const AI_SYSTEM_INSTRUCTION = `You are SmartRent Copilot, the AI assistant embedded in a construction/mining equipment rental fleet platform.
You are given a JSON "context" object containing the CURRENT, real, server-computed state of the fleet (assets, alerts, geofence violations, optimization recommendations, financial estimates). This is the only source of truth you may use for facts and numbers.
Rules:
- NEVER invent asset IDs, sites, operators, or numbers that are not present in the provided context.
- All financial/idle-cost figures are already calculated for you in the context; reuse them, do not recompute or guess new ones.
- If the user asks you to take an action that changes fleet state (relocate/return/reassign an asset), do NOT claim you performed it. Instead propose it via the action_proposal field and require the user to confirm in the UI.
- Only propose an action_proposal of type "RELOCATE_ASSET", "RETURN_EARLY", or "ASSIGN_OPERATOR", and only using an asset_id and site/operator ids that exist in the context. If the best matching action exists in top_recommendations, reuse its id as recommendation_id.
- Be concise, specific, and prioritized. When asked "what needs my attention" or "top priorities", rank by severity/cost and reference concrete asset IDs.
- If information isn't in the context, say so plainly instead of guessing.
Respond ONLY with a JSON object of this exact shape:
{ "answer": "markdown-formatted natural language answer", "action_proposal": null | { "type": "RELOCATE_ASSET" | "RETURN_EARLY" | "ASSIGN_OPERATOR", "asset_id": string, "recommendation_id": string | null, "summary": string } }`;

function ruleBasedAiFallback(message: string, context: ReturnType<typeof buildFleetContext>) {
  const lower = message.toLowerCase();
  const lines: string[] = [];
  if (lower.includes('attention') || lower.includes('priorit') || lower.includes('summary') || lower.includes('summarize')) {
    lines.push(`**Fleet snapshot** — ${context.fleet_summary.total_assets} assets, ${context.fleet_summary.active} active, ${context.fleet_summary.overdue_rentals} overdue, ${context.fleet_summary.active_geofence_violations} geofence violation(s).`);
    lines.push(`Estimated idle waste: **$${context.fleet_summary.estimated_daily_idle_waste_usd.toLocaleString()}/day** ($${context.fleet_summary.estimated_weekly_idle_waste_usd.toLocaleString()}/week).`);
    context.active_alerts.filter((a) => a.severity === 'Critical').slice(0, 5).forEach((a, i) => {
      lines.push(`${i + 1}. **${a.asset_id}** — ${a.type}: ${a.description}`);
    });
  } else if (lower.includes('idle')) {
    const idleAssets = context.assets.filter((a) => a.idle_hours_day > BUSINESS_RULES.highIdleHoursPerDay.warning);
    lines.push(idleAssets.length ? `Idle units: ${idleAssets.map((a) => `**${a.id}** (${a.idle_hours_day}h/day, ~$${a.estimated_daily_idle_waste_usd}/day waste)`).join(', ')}` : 'No units are currently above the high-idle threshold.');
  } else if (lower.includes('overdue')) {
    const overdue = context.assets.filter((a) => a.is_overdue);
    lines.push(overdue.length ? `Overdue rentals: ${overdue.map((a) => `**${a.id}** (due ${a.checkin_date})`).join(', ')}` : 'No rentals are currently overdue.');
  } else if (lower.includes('geofence') || lower.includes('outside')) {
    lines.push(context.geofence_violations.length ? context.geofence_violations.map((v) => `**${v.asset_id}** is ${(v.distance_m / 1000).toFixed(1)} km outside its ${v.site_id} boundary (${v.severity}).`).join('\n') : 'No active geofence violations.');
  } else {
    lines.push(`I couldn't reach the AI model, so here's what the fleet data shows directly: ${context.fleet_summary.active} active, ${context.fleet_summary.overdue_rentals} overdue, ${context.fleet_summary.active_geofence_violations} geofence violation(s), estimated idle waste $${context.fleet_summary.estimated_daily_idle_waste_usd}/day. Ask about "idle", "overdue", "geofence", or "priorities" for specifics.`);
  }
  return { answer: lines.join('\n\n'), action_proposal: null, source: 'rules-engine' as const };
}

app.post('/api/ai/chat', async (req, res) => {
  const { message, history = [], page_context } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });

  const context = buildFleetContext({
    assets: fleetAssets,
    sites: SITES,
    operators: OPERATORS,
    alerts: getAlerts() as any,
    openGeofenceEvents: getOpenGeofenceEvents(),
    recommendations: getRecommendations(),
  });

  const provider = getAiProvider();
  if (!provider.available) {
    return res.json({ success: true, ...ruleBasedAiFallback(message, context) });
  }

  try {
    const historyText = Array.isArray(history) && history.length
      ? `\n\nRecent conversation:\n${history.slice(-6).map((h: any) => `${h.role}: ${h.content}`).join('\n')}`
      : '';
    const pageContextText = page_context && typeof page_context === 'string'
      ? `\n\nThe user is currently looking at: ${page_context}. Prefer that context when it's relevant to their question.`
      : '';
    const prompt = `Fleet context (JSON):\n${JSON.stringify(context)}${pageContextText}${historyText}\n\nUser question: ${message}`;
    const result = await provider.generateJSON<{ answer: string; action_proposal: any }>(prompt, {
      systemInstruction: AI_SYSTEM_INSTRUCTION,
      temperature: 0.2,
    });
    res.json({ success: true, answer: result.answer, action_proposal: result.action_proposal || null, source: provider.name });
  } catch (error: any) {
    console.warn('AI chat provider failed, using rules-engine fallback:', error.message);
    res.json({ success: true, ...ruleBasedAiFallback(message, context), fallback_reason: error.message });
  }
});

// -------------------------------------------------------------
// DEMO SCENARIO CONTROLS
// -------------------------------------------------------------
// Each control here calls the SAME backend logic real telemetry/events would
// hit (evaluateGeofence, refreshServerAlerts, persistAsset) -- it just seeds
// a starting condition instead of waiting on the random walk. Nothing here
// fabricates a UI-only alert.

app.post('/api/demo/simulate-geofence-violation/:id', (req, res) => {
  const asset = fleetAssets.find((a) => a.id.toLowerCase() === req.params.id.toLowerCase());
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!asset.site_id) return res.status(400).json({ error: 'Asset must be assigned to a site to simulate a geofence violation' });
  geofenceDriftAssetIds.add(asset.id);
  liveTrackedAssetIds.add(asset.id);
  publishDemoTelemetry(asset.id);
  publishDemoTelemetry(asset.id);
  publishDemoTelemetry(asset.id);
  res.json({ success: true, message: `${asset.id} is now drifting outside its assigned geofence on each telemetry tick.`, asset: fleetAssets.find((a) => a.id === asset.id) });
});

app.post('/api/demo/clear-geofence-violation/:id', (req, res) => {
  const index = fleetAssets.findIndex((a) => a.id.toLowerCase() === req.params.id.toLowerCase());
  if (index === -1) return res.status(404).json({ error: 'Asset not found' });
  geofenceDriftAssetIds.delete(fleetAssets[index].id);
  const site = SITES.find((s) => s.id === fleetAssets[index].site_id);
  if (site) fleetAssets[index] = { ...fleetAssets[index], location: site.location };
  const geofence = evaluateGeofence(fleetAssets[index]);
  fleetAssets[index].geofence_status = geofence.status;
  fleetAssets[index].geofence_distance_m = geofence.distance_m;
  persistAsset(fleetAssets[index]);
  refreshServerAlerts();
  res.json({ success: true, asset: fleetAssets[index] });
});

app.post('/api/demo/simulate-high-idle/:id', (req, res) => {
  const index = fleetAssets.findIndex((a) => a.id.toLowerCase() === req.params.id.toLowerCase());
  if (index === -1) return res.status(404).json({ error: 'Asset not found' });
  fleetAssets[index] = { ...fleetAssets[index], idle_hours_day: 11.5, engine_hours_day: Math.min(fleetAssets[index].engine_hours_day, 0.5) };
  persistAsset(fleetAssets[index]);
  refreshServerAlerts();
  res.json({ success: true, asset: fleetAssets[index] });
});

app.post('/api/demo/simulate-maintenance-alert/:id', (req, res) => {
  const index = fleetAssets.findIndex((a) => a.id.toLowerCase() === req.params.id.toLowerCase());
  if (index === -1) return res.status(404).json({ error: 'Asset not found' });
  fleetAssets[index] = { ...fleetAssets[index], health_score: 42, next_maintenance_hours: 0 };
  persistAsset(fleetAssets[index]);
  refreshServerAlerts();
  res.json({ success: true, asset: fleetAssets[index] });
});

app.post('/api/demo/simulate-overdue-rental/:id', (req, res) => {
  const index = fleetAssets.findIndex((a) => a.id.toLowerCase() === req.params.id.toLowerCase());
  if (index === -1) return res.status(404).json({ error: 'Asset not found' });
  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - 3);
  fleetAssets[index] = { ...fleetAssets[index], status: 'Active', checkin_date: overdueDate.toISOString().split('T')[0] };
  persistAsset(fleetAssets[index]);
  refreshServerAlerts();
  res.json({ success: true, asset: fleetAssets[index] });
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
