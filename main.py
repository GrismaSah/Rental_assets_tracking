import json
import os
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Caterpillar Fleet Smart Asset Rental Tracking API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_PATH = os.path.join(os.path.dirname(__file__), "assets.json")

def load_assets():
    if os.path.exists(DATA_PATH):
        with open(DATA_PATH, "r") as f:
            return json.load(f)
    return []

def save_assets(assets):
    with open(DATA_PATH, "w") as f:
        json.dump(assets, f, indent=2)

class CheckInRequest(BaseModel):
    id: str
    ending_engine_hours: Optional[float] = 0.0
    fuel_level_pct: Optional[int] = 100
    inspection_notes: Optional[str] = "Normal check-in routine inspection"

class CheckOutRequest(BaseModel):
    id: str
    site_id: str
    operator_id: Optional[str] = None
    checkout_date: Optional[str] = "2025-04-01"
    checkin_date: Optional[str] = "2025-04-30"

@app.get("/")
def read_root():
    return {"message": "Caterpillar Fleet Smart Asset Tracking API is operational", "assets_count": len(load_assets())}

@app.get("/assets")
def get_assets():
    return load_assets()

@app.get("/assets/{asset_id}")
def get_asset(asset_id: str):
    assets = load_assets()
    for a in assets:
        if a["id"].lower() == asset_id.lower():
            return a
    raise HTTPException(status_code=404, detail="Asset not found")

@app.post("/check-in")
def check_in(payload: CheckInRequest):
    assets = load_assets()
    for a in assets:
        if a["id"].lower() == payload.id.lower():
            a["status"] = "Idle"
            a["operator_id"] = None
            save_assets(assets)
            return {"status": "success", "message": f"Asset {payload.id} checked in successfully.", "asset": a}
    raise HTTPException(status_code=404, detail="Asset not found")

@app.post("/check-out")
def check_out(payload: CheckOutRequest):
    assets = load_assets()
    for a in assets:
        if a["id"].lower() == payload.id.lower():
            a["status"] = "Active"
            a["site_id"] = payload.site_id
            a["operator_id"] = payload.operator_id
            a["checkout_date"] = payload.checkout_date
            a["checkin_date"] = payload.checkin_date
            save_assets(assets)
            return {"status": "success", "message": f"Asset {payload.id} checked out to site {payload.site_id}.", "asset": a}
    raise HTTPException(status_code=404, detail="Asset not found")

@app.get("/anomalies")
def get_anomalies():
    assets = load_assets()
    anomalies = []
    for a in assets:
        if a.get("idle_hours_day", 0) > 8:
            anomalies.append({
                "asset_id": a["id"],
                "type": "High Idle Hours",
                "severity": "Critical" if a.get("idle_hours_day", 0) >= 11 else "Warning",
                "idle_hours": a.get("idle_hours_day"),
                "description": f"Asset {a['id']} idled {a.get('idle_hours_day')} hrs/day."
            })
        if a.get("status") == "Active" and not a.get("operator_id"):
            anomalies.append({
                "asset_id": a["id"],
                "type": "Unassigned Operator",
                "severity": "Critical",
                "description": f"Asset {a['id']} is active without an assigned operator."
            })
    return {"total_anomalies": len(anomalies), "anomalies": anomalies}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
