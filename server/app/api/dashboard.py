import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, extract
from app.models.database import get_db
from app.models.schemas import RiskAssessmentRecord
from app.auth.jwt import verify_token

router = APIRouter()


class OverviewStats(BaseModel):
    total_sessions: int
    high_risk_count: int
    medium_risk_count: int
    low_risk_count: int
    avg_communication: float | None
    avg_clinical: float | None
    avg_behavioral: float | None
    avg_overall: float | None


class TrendPoint(BaseModel):
    period: str
    avg_communication: float
    avg_clinical: float
    avg_behavioral: float
    avg_overall: float
    session_count: int


@router.get("/overview", response_model=OverviewStats)
async def get_overview(
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_token),
):
    """Get overall dashboard statistics."""
    result = await db.execute(
        select(
            func.count(RiskAssessmentRecord.id),
            func.avg(RiskAssessmentRecord.communication_score),
            func.avg(RiskAssessmentRecord.clinical_score),
            func.avg(RiskAssessmentRecord.behavioral_score),
            func.avg(RiskAssessmentRecord.overall_score),
        )
    )
    total, avg_comm, avg_clin, avg_behav, avg_overall = result.one()

    # Risk level counts
    risk_counts = {}
    for level in ["high", "medium", "low"]:
        count_result = await db.execute(
            select(func.count(RiskAssessmentRecord.id)).where(
                RiskAssessmentRecord.overall_risk == level
            )
        )
        risk_counts[level] = count_result.scalar()

    return OverviewStats(
        total_sessions=total or 0,
        high_risk_count=risk_counts.get("high", 0),
        medium_risk_count=risk_counts.get("medium", 0),
        low_risk_count=risk_counts.get("low", 0),
        avg_communication=round(avg_comm, 1) if avg_comm else None,
        avg_clinical=round(avg_clin, 1) if avg_clin else None,
        avg_behavioral=round(avg_behav, 1) if avg_behav else None,
        avg_overall=round(avg_overall, 1) if avg_overall else None,
    )


@router.get("/trends", response_model=list[TrendPoint])
async def get_trends(
    doctor_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_token),
):
    """Get risk score trends over time, grouped by month."""
    query = select(
        func.date_trunc("month", RiskAssessmentRecord.timestamp).label("period"),
        func.avg(RiskAssessmentRecord.communication_score),
        func.avg(RiskAssessmentRecord.clinical_score),
        func.avg(RiskAssessmentRecord.behavioral_score),
        func.avg(RiskAssessmentRecord.overall_score),
        func.count(RiskAssessmentRecord.id),
    ).group_by("period").order_by("period")

    if doctor_id:
        query = query.where(RiskAssessmentRecord.doctor_id == doctor_id)

    result = await db.execute(query)
    rows = result.all()

    return [
        TrendPoint(
            period=row[0].isoformat() if row[0] else "",
            avg_communication=round(row[1], 1) if row[1] else 0,
            avg_clinical=round(row[2], 1) if row[2] else 0,
            avg_behavioral=round(row[3], 1) if row[3] else 0,
            avg_overall=round(row[4], 1) if row[4] else 0,
            session_count=row[5],
        )
        for row in rows
    ]
