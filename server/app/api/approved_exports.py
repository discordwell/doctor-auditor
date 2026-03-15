from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.review_models import ApprovedExportModel
from app.auth.jwt import verify_token
from app.models.database import get_db
from app.services.review_repository import (
    current_organization_id,
    get_approved_export as get_approved_export_model,
    ingest_approved_export as ingest_approved_export_record,
    list_approved_exports as list_approved_export_models,
)

router = APIRouter()


@router.get("/", response_model=list[ApprovedExportModel])
async def list_approved_exports(
    session_id: str | None = None,
    export_status: str | None = None,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    return await list_approved_export_models(
        db=db,
        organization_id=organization_id,
        session_id=session_id,
        status=export_status,
    )


@router.get("/{export_id}", response_model=ApprovedExportModel)
async def get_approved_export(
    export_id: str,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    export = await get_approved_export_model(db, organization_id, export_id)
    if export is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Approved export '{export_id}' was not found",
        )
    return export


@router.post("/", response_model=ApprovedExportModel, status_code=status.HTTP_201_CREATED)
async def ingest_approved_export(
    payload: ApprovedExportModel,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    export = await ingest_approved_export_record(db, organization_id, payload)
    if export is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Session '{payload.sessionId}' was not found for the approved export"
            ),
        )
    return export
