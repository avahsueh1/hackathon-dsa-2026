from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .policy_map import policy_map_payload


app = FastAPI(
    title="StreetShift SD API",
    version="0.2.0",
    description=(
        "Focused policy-period evidence map for San Diego's fixed 261-block "
        "Downtown unsheltered-count panel."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "streetshift-api"}


@app.get("/api/policy-map")
def policy_map() -> dict:
    """Return the dated block comparison, context layers, and evidence limits."""
    return policy_map_payload()
