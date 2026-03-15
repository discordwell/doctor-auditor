from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.review_models import ReviewSessionModel
from app.auth.jwt import verify_token
from app.models.database import get_db
from app.services.review_repository import (
    current_organization_id,
    get_session as get_session_model,
    list_sessions as list_session_models,
    upsert_session as upsert_session_model,
)

router = APIRouter()


@router.get("/", response_model=list[ReviewSessionModel])
async def list_sessions(
    review_status: str | None = None,
    export_status: str | None = None,
    clinician_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    return await list_session_models(
        db=db,
        organization_id=organization_id,
        review_status=review_status,
        export_status=export_status,
        clinician_id=clinician_id,
    )


@router.get("/{session_id}", response_model=ReviewSessionModel)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    session = await get_session_model(db, organization_id, session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' was not found",
        )
    return session


@router.post("/", response_model=ReviewSessionModel, status_code=status.HTTP_201_CREATED)
async def upsert_session(
    payload: ReviewSessionModel,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    if payload.organizationId not in {None, organization_id}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session organization does not match authenticated organization",
        )
    return await upsert_session_model(db, organization_id, payload)
