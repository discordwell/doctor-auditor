from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.review_models import (
    FindingModel,
    ReviewDecisionCreateRequest,
    ReviewDecisionModel,
)
from app.auth.jwt import verify_token
from app.models.database import get_db
from app.services.review_repository import (
    create_review_decision as create_review_decision_record,
    current_organization_id,
    get_finding as get_finding_model,
    list_findings as list_finding_models,
)

router = APIRouter()


@router.get("/", response_model=list[FindingModel])
async def list_findings(
    session_id: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    return await list_finding_models(
        db=db,
        organization_id=organization_id,
        session_id=session_id,
        status=status,
    )


@router.get("/{finding_id}", response_model=FindingModel)
async def get_finding(
    finding_id: str,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    finding = await get_finding_model(db, organization_id, finding_id)
    if finding is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finding '{finding_id}' was not found",
        )
    return finding


@router.post(
    "/{finding_id}/review-decisions",
    response_model=ReviewDecisionModel,
    status_code=status.HTTP_201_CREATED,
)
async def create_review_decision(
    finding_id: str,
    payload: ReviewDecisionCreateRequest,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    decision = await create_review_decision_record(
        db=db,
        organization_id=organization_id,
        finding_id=finding_id,
        payload=payload,
    )
    if decision is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finding '{finding_id}' was not found",
        )
    return decision
