from datetime import datetime, timedelta, timezone
from jose import ExpiredSignatureError, JWTError, jwt
from jose.exceptions import JWTClaimsError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.config import settings

security = HTTPBearer()


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _decode_token(token: str) -> dict:
    """Decode with the active secret first, then any rotation fallbacks."""
    # jwt_decode_secrets always yields at least the active secret, so the
    # loop runs at least once and last_error is never raised unassigned.
    last_error: JWTError = JWTError("Invalid token")
    for secret in settings.jwt_decode_secrets:
        try:
            return jwt.decode(token, secret, algorithms=[settings.jwt_algorithm])
        except (ExpiredSignatureError, JWTClaimsError):
            # Claims are only validated after the signature matched this
            # secret, so trying further secrets would just replace the real
            # failure with a misleading signature error.
            raise
        except JWTError as exc:
            last_error = exc
    raise last_error


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = _decode_token(credentials.credentials)
        if payload.get("sub") is None or (
            payload.get("org") is None and payload.get("organization_id") is None
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def require_role(required_role: str):
    def role_checker(token_data: dict = Depends(verify_token)):
        if token_data.get("role") != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {required_role} role",
            )
        return token_data
    return role_checker
