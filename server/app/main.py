from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import approved_exports, assist_gateway, auth, demo, ops_events
from app.models.database import engine, Base
import app.models.schemas  # noqa: F401 — register models with Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="Doctor Auditor API",
    description="Approved export, safe ops, and assist gateway API surfaces",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(demo.router, prefix="/api/demo", tags=["demo"])
app.include_router(
    approved_exports.router,
    prefix="/api/approved-exports",
    tags=["approved-exports"],
)
app.include_router(ops_events.router, prefix="/api/ops-events", tags=["ops-events"])
app.include_router(
    assist_gateway.router,
    prefix="/api/assist-gateway",
    tags=["assist-gateway"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "doctor-auditor-api",
        "surface": ["auth", "approved-exports", "ops-events", "assist-gateway"],
    }
