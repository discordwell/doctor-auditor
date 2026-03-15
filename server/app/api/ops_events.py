from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.cloud_models import OpsEventModel, OpsSummaryModel
from app.auth.jwt import verify_token
from app.models.database import get_db
from app.services.cloud_repository import (
    OpsEventIngestError,
    current_organization_id,
    get_ops_summary,
    ingest_ops_event,
    list_ops_events,
)

router = APIRouter()


@router.get("/", response_model=list[OpsEventModel])
async def get_ops_events(
    local_session_id: str | None = None,
    event_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    return await list_ops_events(
        db=db,
        organization_id=organization_id,
        local_session_id=local_session_id,
        event_type=event_type,
    )


@router.post("/", response_model=OpsEventModel)
async def post_ops_event(
    payload: OpsEventModel,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    try:
        return await ingest_ops_event(db, organization_id, payload)
    except OpsEventIngestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/summary", response_model=OpsSummaryModel)
async def get_summary(
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    return await get_ops_summary(db, organization_id)
