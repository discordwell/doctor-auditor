import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect

from app.api import approved_exports, assist_gateway, auth, demo, ops_events
from app.auth.jwt import verify_token
from app.config import settings
from app.models.database import Base, engine
from app.observability import configure_logging, log_json, set_request_id
import app.models.schemas  # noqa: F401 — register models with Base

configure_logging(settings.log_level)
logger = logging.getLogger(__name__)
settings.validate_deployment()


def _sync_ops_event_schema(connection) -> None:
    inspector = inspect(connection)
    if "ops_events" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("ops_events")}
    if "assessment_payload" not in columns:
        connection.exec_driver_sql(
            "ALTER TABLE ops_events ADD COLUMN assessment_payload JSON"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_sync_ops_event_schema)
    yield


app = FastAPI(
    title="Doctor Auditor API",
    description="Approved export, safe ops, and assist gateway API surfaces",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    request.state.request_id = request_id
    set_request_id(request_id)
    started_at = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        log_json(
            logger,
            "http.request.failed",
            method=request.method,
            path=request.url.path,
            client=request.client.host if request.client else None,
            durationMs=round((time.perf_counter() - started_at) * 1000),
        )
        set_request_id(None)
        raise

    response.headers["X-Request-ID"] = request_id
    log_json(
        logger,
        "http.request.completed",
        method=request.method,
        path=request.url.path,
        statusCode=response.status_code,
        client=request.client.host if request.client else None,
        durationMs=round((time.perf_counter() - started_at) * 1000),
    )
    set_request_id(None)
    return response


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# Every data router requires an authenticated token at the boundary, so a
# newly added route cannot ship unauthenticated by omission. Routes that need
# the token claims still declare their own Depends(verify_token); FastAPI
# caches the dependency per request, so it is not evaluated twice.
authenticated = [Depends(verify_token)]
app.include_router(
    demo.router, prefix="/api/demo", tags=["demo"], dependencies=authenticated
)
app.include_router(
    approved_exports.router,
    prefix="/api/approved-exports",
    tags=["approved-exports"],
    dependencies=authenticated,
)
app.include_router(
    ops_events.router,
    prefix="/api/ops-events",
    tags=["ops-events"],
    dependencies=authenticated,
)
app.include_router(
    assist_gateway.router,
    prefix="/api/assist-gateway",
    tags=["assist-gateway"],
    dependencies=authenticated,
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "doctor-auditor-api",
        "surface": ["auth", "approved-exports", "ops-events", "assist-gateway"],
        "assistGateway": {
            "enabled": settings.assist_gateway_enabled,
            "configured": bool(settings.openai_api_key),
            "model": settings.assist_gateway_model,
            "promptVersion": settings.assist_gateway_prompt_version,
        },
    }
