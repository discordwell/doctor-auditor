from fastapi import APIRouter, Depends, HTTPException, status

from app.api.review_models import ApprovedExportModel
from app.auth.jwt import verify_token
from app.services.review_store import current_organization_id, review_store

router = APIRouter()


@router.get("/", response_model=list[ApprovedExportModel])
async def list_approved_exports(
    session_id: str | None = None,
    export_status: str | None = None,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    return review_store.list_approved_exports(
        organization_id=organization_id,
        session_id=session_id,
        status=export_status,
    )


@router.get("/{export_id}", response_model=ApprovedExportModel)
async def get_approved_export(
    export_id: str,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    try:
        return review_store.get_approved_export(organization_id, export_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Approved export '{export_id}' was not found",
        ) from exc


@router.post("/", response_model=ApprovedExportModel, status_code=status.HTTP_201_CREATED)
async def ingest_approved_export(
    payload: ApprovedExportModel,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    try:
        return review_store.ingest_approved_export(organization_id, payload)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Session '{payload.sessionId}' was not found for the approved export"
            ),
        ) from exc
