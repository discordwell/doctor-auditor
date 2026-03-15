import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.database import get_db
from app.models.schemas import Doctor, RiskAssessmentRecord
from app.auth.jwt import verify_token

router = APIRouter()


class DoctorSummary(BaseModel):
    id: str
    specialty: str | None
    department_id: str | None
    organization_id: str
    total_sessions: int
    avg_overall_score: float | None
    latest_risk: str | None


@router.get("/", response_model=list[DoctorSummary])
async def list_doctors(
    organization_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_token),
):
    """List doctors with aggregated risk metrics."""
    query = select(Doctor)
    if organization_id:
        query = query.where(Doctor.organization_id == organization_id)

    result = await db.execute(query)
    doctors = result.scalars().all()

    summaries = []
    for doctor in doctors:
        # Get aggregated stats
        stats = await db.execute(
            select(
                func.count(RiskAssessmentRecord.id),
                func.avg(RiskAssessmentRecord.overall_score),
            ).where(RiskAssessmentRecord.doctor_id == doctor.id)
        )
        count, avg_score = stats.one()

        # Get latest risk level
        latest = await db.execute(
            select(RiskAssessmentRecord.overall_risk)
            .where(RiskAssessmentRecord.doctor_id == doctor.id)
            .order_by(RiskAssessmentRecord.timestamp.desc())
            .limit(1)
        )
        latest_risk = latest.scalar_one_or_none()

        summaries.append(
            DoctorSummary(
                id=doctor.id,
                specialty=doctor.specialty,
                department_id=doctor.department_id,
                organization_id=doctor.organization_id,
                total_sessions=count,
                avg_overall_score=round(avg_score, 1) if avg_score else None,
                latest_risk=latest_risk,
            )
        )

    return summaries
