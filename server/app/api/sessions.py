from fastapi import APIRouter, Depends, HTTPException, status

from app.api.review_models import ReviewSessionModel, SessionBundleModel
from app.auth.jwt import verify_token
from app.services.review_store import current_organization_id, review_store

router = APIRouter()


@router.get("/", response_model=list[ReviewSessionModel])
async def list_sessions(
    review_status: str | None = None,
    export_status: str | None = None,
    clinician_id: str | None = None,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    return review_store.list_sessions(
        organization_id=organization_id,
        review_status=review_status,
        export_status=export_status,
        clinician_id=clinician_id,
    )


@router.get("/{session_id}", response_model=SessionBundleModel)
async def get_session(
    session_id: str,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    try:
        return review_store.get_session_bundle(organization_id, session_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' was not found",
        ) from exc


@router.post("/", response_model=SessionBundleModel, status_code=status.HTTP_201_CREATED)
async def upsert_session(
    payload: SessionBundleModel,
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    try:
        return review_store.upsert_session_bundle(organization_id, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
