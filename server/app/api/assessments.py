import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.database import get_db
from app.models.schemas import RiskAssessmentRecord, Doctor
from app.auth.jwt import verify_token

router = APIRouter()


class RiskCategoryPayload(BaseModel):
    score: float
    flags: list[str]


class AssessmentPayload(BaseModel):
    session_id: str
    doctor_id: str
    timestamp: str
    duration: float
    communication: RiskCategoryPayload
    clinical: RiskCategoryPayload
    behavioral: RiskCategoryPayload
    overall_score: float
    overall_risk: str
    analysis_source: str


class AssessmentResponse(BaseModel):
    id: str
    session_id: str
    doctor_id: str
    timestamp: str
    duration: float
    communication_score: float
    communication_flags: list[str]
    clinical_score: float
    clinical_flags: list[str]
    behavioral_score: float
    behavioral_flags: list[str]
    overall_score: float
    overall_risk: str
    analysis_source: str


@router.post("/", status_code=201)
async def submit_assessment(
    payload: AssessmentPayload,
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_token),
):
    """Receive a de-identified risk assessment from a desktop client."""
    # Ensure doctor exists, create if not
    doctor = await db.get(Doctor, payload.doctor_id)
    if not doctor:
        doctor = Doctor(
            id=payload.doctor_id,
            organization_id=_token.get("org", "default"),
        )
        db.add(doctor)

    record = RiskAssessmentRecord(
        session_id=payload.session_id,
        doctor_id=payload.doctor_id,
        timestamp=datetime.fromisoformat(payload.timestamp),
        duration=payload.duration,
        communication_score=payload.communication.score,
        communication_flags=json.dumps(payload.communication.flags),
        clinical_score=payload.clinical.score,
        clinical_flags=json.dumps(payload.clinical.flags),
        behavioral_score=payload.behavioral.score,
        behavioral_flags=json.dumps(payload.behavioral.flags),
        overall_score=payload.overall_score,
        overall_risk=payload.overall_risk,
        analysis_source=payload.analysis_source,
    )
    db.add(record)
    await db.commit()

    return {"id": str(record.id), "status": "received"}


@router.get("/", response_model=list[AssessmentResponse])
async def list_assessments(
    doctor_id: str | None = None,
    risk_level: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_token),
):
    """List de-identified risk assessments with optional filters."""
    query = select(RiskAssessmentRecord).order_by(
        RiskAssessmentRecord.timestamp.desc()
    )

    if doctor_id:
        query = query.where(RiskAssessmentRecord.doctor_id == doctor_id)
    if risk_level:
        query = query.where(RiskAssessmentRecord.overall_risk == risk_level)

    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    records = result.scalars().all()

    return [
        AssessmentResponse(
            id=str(r.id),
            session_id=r.session_id,
            doctor_id=r.doctor_id,
            timestamp=r.timestamp.isoformat(),
            duration=r.duration,
            communication_score=r.communication_score,
            communication_flags=json.loads(r.communication_flags),
            clinical_score=r.clinical_score,
            clinical_flags=json.loads(r.clinical_flags),
            behavioral_score=r.behavioral_score,
            behavioral_flags=json.loads(r.behavioral_flags),
            overall_score=r.overall_score,
            overall_risk=r.overall_risk,
            analysis_source=r.analysis_source,
        )
        for r in records
    ]
