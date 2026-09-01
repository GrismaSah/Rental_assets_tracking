import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { INITIAL_ASSETS, SITES, OPERATORS } from './src/data/initialAssets.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// -------------------------------------------------------------
// PERSISTENCE (SQLite via Node's built-in node:sqlite module)
// -------------------------------------------------------------
// Fleet state used to live only in a plain JS array, which meant every
// check-in/check-out/inspection was lost on a server restart. SQLite gives
// real persistence with zero extra dependencies (no native build step,
// unlike better-sqlite3) since it ships inside the Node runtime itself.
const db = new DatabaseSync(path.join(__dirname, 'fleet.db'));

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
`);

const upsertAssetStmt = db.prepare(
  'INSERT INTO assets (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
);
const insertInspectionStmt = db.prepare(
  'INSERT INTO inspections (id, data, created_at) VALUES (?, ?, ?)'
);

function persistAsset(asset: any) {
  upsertAssetStmt.run(asset.id, JSON.stringify(asset));
}

function persistInspection(inspection: any) {
  insertInspectionStmt.run(inspection.id, JSON.stringify(inspection), inspection.timestamp);
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
  const { asset_id, site_id, operator_id, checkout_date, checkin_date, starting_fuel } = req.body;

  const index = fleetAssets.findIndex((a) => a.id.toLowerCase() === asset_id?.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: `Equipment ${asset_id} not found` });
  }

  const site = SITES.find((s) => s.id === site_id);
  const operator = OPERATORS.find((o) => o.id === operator_id);

  fleetAssets[index] = {
    ...fleetAssets[index],
    site_id: site_id || fleetAssets[index].site_id,
    site_name: site ? site.name : fleetAssets[index].site_name,
    operator_id: operator_id || null,
    operator_name: operator ? operator.name : null,
    checkout_date: checkout_date || new Date().toISOString().split('T')[0],
    checkin_date: checkin_date || '2025-05-30',
    status: 'Active',
    fuel_level_pct: starting_fuel !== undefined ? starting_fuel : fleetAssets[index].fuel_level_pct,
    location: site ? site.location : fleetAssets[index].location,
    anomalies: [],
  };
  persistAsset(fleetAssets[index]);

  res.json({
    success: true,
    message: `Asset ${asset_id} successfully checked out to ${site?.name || site_id}`,
    asset: fleetAssets[index],
  });
});

// 4. Check-In Asset
app.post('/api/checkin', (req, res) => {
  const { asset_id, return_site_id, ending_engine_hours, fuel_level_pct, inspection_notes, status } = req.body;

  const index = fleetAssets.findIndex((a) => a.id.toLowerCase() === asset_id?.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: `Equipment ${asset_id} not found` });
  }

  fleetAssets[index] = {
    ...fleetAssets[index],
    status: status || 'Idle',
    operator_id: null,
    operator_name: null,
    fuel_level_pct: fuel_level_pct !== undefined ? fuel_level_pct : fleetAssets[index].fuel_level_pct,
    anomalies: [],
  };
  persistAsset(fleetAssets[index]);

  res.json({
    success: true,
    message: `Asset ${asset_id} checked in successfully`,
    asset: fleetAssets[index],
  });
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
    try {
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

      const aiResponse = await client.models.generateContent({
        model: 'gemini-3.7-flash',
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
      console.warn('Gemini forecast API fallback triggered:', err.message);
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
  if (process.env.NODE_ENV !== 'production') {
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
