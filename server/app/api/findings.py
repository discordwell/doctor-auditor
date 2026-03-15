from fastapi import APIRouter, Depends, HTTPException, status

from app.api.review_models import (
    FindingModel,
    ReviewDecisionCreateRequest,
    ReviewDecisionModel,
)
from app.auth.jwt import verify_token
from app.services.review_store import current_organization_id, review_store

router = APIRouter()


@router.get("/", response_model=list[FindingModel])
async def list_findings(
    session_id: str | None = None,
    status: str | None = None,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    return review_store.list_findings(
        organization_id=organization_id,
        session_id=session_id,
        status=status,
    )


@router.get("/{finding_id}", response_model=FindingModel)
async def get_finding(
    finding_id: str,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    try:
        return review_store.get_finding(organization_id, finding_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finding '{finding_id}' was not found",
        ) from exc


@router.post(
    "/{finding_id}/review-decisions",
    response_model=ReviewDecisionModel,
    status_code=status.HTTP_201_CREATED,
)
async def create_review_decision(
    finding_id: str,
    payload: ReviewDecisionCreateRequest,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    try:
        return review_store.create_review_decision(
            organization_id=organization_id,
            finding_id=finding_id,
            payload=payload,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finding '{finding_id}' was not found",
        ) from exc
