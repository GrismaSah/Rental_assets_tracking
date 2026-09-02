# Fleet Rental Tracker

A full-stack prototype for managing rental construction equipment. It gives fleet teams a single workspace for locating assets, reviewing utilization, checking equipment in and out, completing inspections, detecting operational risks, and forecasting the machinery needed for a project.

The product is designed around the presentation narrative in [PRESENTATION_GUIDE.md](PRESENTATION_GUIDE.md): reduce avoidable rental and idle-time costs by turning fleet telemetry into clear operating actions.

## What the application does

- **Fleet map** — visualizes the current location, condition, utilization, and assignment of each seeded asset.
- **Telematics analytics** — shows fleet and site-level engine time, idle time, fuel, emissions, and estimated idle-cost metrics.
- **Check-in / check-out** — records deployments and returns, including site, operator, dates, fuel, and whether the handover originated through a QR link or a manual form.
- **QR equipment tags** — generates a QR code that deep-links to `?scan=<asset-id>` and opens a prefilled check-in/out flow.
- **Inspections** — captures a checklist and risk score; inspections above the risk threshold put the asset into maintenance status.
- **Anomaly rules** — identifies high idle time, unassigned equipment, unassigned operators, approaching or overdue rentals, and low-health/maintenance conditions.
- **Alert audit trail** — retains alerts after their underlying condition clears, with acknowledgement and simulated notification records.
- **Demand forecasting** — requests a structured machinery recommendation from Gemini when configured, and otherwise returns a deterministic rules-engine forecast.

## Architecture

```text
React + Vite UI
       |
       | REST requests
       v
Express server (server.ts)
  |         |          |
  |         |          +-- Gemini API (optional forecast generation)
  |         +-- node:sqlite (fleet.db)
  +-- Seeded assets, sites, and operators
```

The frontend is a React 19 single-page app. Express serves its API and Vite middleware in development. Current asset state, inspection records, and the append-only rental-event history are persisted in the local SQLite database at `fleet.db`.

## Technology

- React 19, TypeScript, Vite, and Tailwind CSS
- Express 4
- Node's built-in `node:sqlite` database API
- Leaflet for maps
- Chart.js / react-chartjs-2 for analytics
- `@google/genai` for optional Gemini forecasting
- QRCode and Lucide React

## Run locally

### Prerequisites

- Node.js 22.5 or later (the server uses the built-in `node:sqlite` API)
- npm
- A Gemini API key only if you want AI-generated forecasts

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file and optionally add a Gemini key:

   ```powershell
   Copy-Item .env.example .env
   ```

   ```dotenv
   GEMINI_API_KEY="your_key_here"
   ```

   The app still runs without this key: forecast requests automatically use the local rules-engine fallback.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Runs Express with Vite middleware on port 3000. |
| `npm run build` | Builds the frontend and bundles the production server into `dist/`. |
| `npm run start` | Intended to serve the production build. Run `npm run build` first; see the production note below. |
| `npm run lint` | Performs TypeScript type checking without emitting files. |

## API overview

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/assets` | Returns current assets, sites, and operators. |
| `GET` | `/api/assets/:id` | Returns a single asset. |
| `POST` | `/api/checkout` | Deploys an asset and records a rental event. |
| `POST` | `/api/checkin` | Returns an asset and records a rental event. |
| `POST` | `/api/inspections` | Stores an inspection and can place an asset under maintenance. |
| `POST` | `/api/forecast` | Produces a Gemini or rules-engine fleet recommendation. |
| `GET` | `/api/history` | Returns the fleet-wide rental-event audit history. |
| `GET` | `/api/history/:assetId` | Returns rental-event history for one asset. |

## Production note

`npm run build` completes successfully, but the current server bundle emits a Node warning because `server.ts` uses `import.meta.url` while the server is bundled as CommonJS. Resolve that module-format mismatch and smoke-test `npm run start` before treating the generated server bundle as production-ready.

## Data and prototype boundaries

The application begins with an embedded sample fleet from `src/data/initialAssets.ts`; it is not connected to physical equipment, GPS devices, or a production rental system. The local SQLite database is seeded on first run and preserves subsequent check-in/out and inspection changes on that machine.

Alert delivery currently records simulated Email, SMS, and in-cab-console dispatches in the UI. It does **not** send messages through external providers. Map locations and telemetry are also sample data. These boundaries are intentional for the demo and should be replaced with authenticated integrations, real telemetry ingestion, provider-backed notifications, and production-grade database operations before deployment.

## Product walkthrough

For the recommended demo sequence, talking points, and Q&A preparation, see [PRESENTATION_GUIDE.md](PRESENTATION_GUIDE.md).

Suggested walkthrough:

1. Start on **Fleet Map** to orient the viewer to the active fleet.
2. Open **Telematics** to show idle and cost signals.
3. Review **Alerts** and the **History** audit trail.
4. Run **AI Forecast** with project duration, volume, and terrain inputs.
5. Complete a **Check-In / Out** or **Inspection** workflow to show how operations update the fleet state.

## Project structure

```text
src/
  components/     Feature views and operational modals
  data/           Seed fleet, sites, and operators
  utils/          QR generation, anomaly rules, notifications, CSV export
  App.tsx         Client-side state and workflow orchestration
server.ts          Express API, SQLite persistence, and forecast endpoint
PRESENTATION_GUIDE.md
                  Demo narrative and presentation preparation
```
