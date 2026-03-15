from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import verify_token
from app.models.database import get_db
from app.services.demo_seed import DemoSeedError, ensure_demo_review_data
from app.services.cloud_repository import current_organization_id

router = APIRouter()


class DemoSeedResponse(BaseModel):
    seeded: bool
    approvedExports: int
    opsEvents: int


@router.post("/seed", response_model=DemoSeedResponse)
async def seed_demo_data(
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(verify_token),
):
    organization_id = current_organization_id(token)
    try:
        result = await ensure_demo_review_data(db, organization_id)
    except DemoSeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return DemoSeedResponse(
        seeded=result.seeded,
        approvedExports=result.approved_exports,
        opsEvents=result.ops_events,
    )
