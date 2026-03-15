from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import assessments, auth, doctors, dashboard

app = FastAPI(
    title="Doctor Auditor API",
    description="Cloud API for de-identified malpractice risk assessments",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(
    assessments.router, prefix="/api/assessments", tags=["assessments"]
)
app.include_router(doctors.router, prefix="/api/doctors", tags=["doctors"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "doctor-auditor-api"}
