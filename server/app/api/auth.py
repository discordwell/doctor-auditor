from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.jwt import create_access_token
from app.auth.passwords import hash_password, verify_and_rehash_password
from app.models.database import get_db
from app.models.schemas import User, UserRole

router = APIRouter()


class RegisterRequest(BaseModel):
    email: str
    password: str
    role: UserRole
    organization_id: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    organization_id: str


@router.post("/register", response_model=TokenResponse)
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == request.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=request.email,
        hashed_password=hash_password(request.password),
        role=request.role,
        organization_id=request.organization_id,
    )
    db.add(user)
    await db.commit()

    token = create_access_token(
        {
            "sub": str(user.id),
            "email": user.email,
            "role": user.role.value,
            "org": user.organization_id,
            "organization_id": user.organization_id,
        }
    )
    return TokenResponse(
        access_token=token,
        role=user.role.value,
        organization_id=user.organization_id,
    )


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == request.email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    password_is_valid, replacement_hash = verify_and_rehash_password(
        request.password,
        user.hashed_password,
    )
    if not password_is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if replacement_hash is not None:
        user.hashed_password = replacement_hash
        await db.commit()

    token = create_access_token(
        {
            "sub": str(user.id),
            "email": user.email,
            "role": user.role.value,
            "org": user.organization_id,
            "organization_id": user.organization_id,
        }
    )
    return TokenResponse(
        access_token=token,
        role=user.role.value,
        organization_id=user.organization_id,
    )
