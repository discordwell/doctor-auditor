from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import approved_exports, auth, findings, sessions
from app.models.database import engine, Base
import app.models.schemas  # noqa: F401 — register models with Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="Doctor Auditor API",
    description="Review workflow API for auditable sessions, findings, and approved exports",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(findings.router, prefix="/api/findings", tags=["findings"])
app.include_router(
    approved_exports.router,
    prefix="/api/approved-exports",
    tags=["approved-exports"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "doctor-auditor-api",
        "surface": ["auth", "sessions", "findings", "approved-exports"],
    }
