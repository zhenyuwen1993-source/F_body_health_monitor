"""FastAPI ingest server.

Receives JSON pushed by the *Health Auto Export* iOS app and stores it.
Point the app's REST API automation at ``http://<this-computer-ip>:8000/api/ingest``.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request

from . import __version__
from .config import settings
from .db import init_db
from .ingest import store_payload
from .queries import table_counts


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="F Body Health Monitor", version=__version__, lifespan=lifespan)


def _check_auth(authorization: str | None, x_api_key: str | None) -> None:
    """Enforce the optional API key (set HM_API_KEY to enable)."""
    if settings.api_key is None:
        return
    token: str | None = None
    if x_api_key:
        token = x_api_key.strip()
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if token != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.get("/")
def root() -> dict:
    return {
        "app": "F Body Health Monitor",
        "version": __version__,
        "ingest_endpoint": "/api/ingest",
        "docs": "/docs",
    }


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "db": str(settings.db_path),
        "auth_required": settings.api_key is not None,
        "counts": table_counts(),
    }


@app.post("/api/ingest")
async def ingest(
    request: Request,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> dict:
    _check_auth(authorization, x_api_key)
    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001 - report any malformed body uniformly
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object")
    summary = store_payload(payload)
    return {"status": "ok", "stored": summary}


def run() -> None:
    """Console entry point (``hm-api``) / ``python -m health_monitor.api``."""
    import uvicorn

    uvicorn.run(
        "health_monitor.api:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level="info",
    )


if __name__ == "__main__":
    run()
