import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum as SAEnum,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    reviewer = "reviewer"
    quality_lead = "quality_lead"
    admin = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class ApprovedExportRecord(Base):
    __tablename__ = "approved_exports"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    local_session_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    clinician_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    encounter_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    encounter_ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    capture_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    consent_recorded_with_consent: Mapped[bool] = mapped_column(
        Boolean, nullable=False
    )
    consent_export_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    consent_remote_assist_allowed: Mapped[bool] = mapped_column(
        Boolean, nullable=False
    )
    consent_policy_version: Mapped[str] = mapped_column(String(100), nullable=False)
    export_status: Mapped[str] = mapped_column(String(32), nullable=False)
    export_summary: Mapped[str] = mapped_column(Text, nullable=False)
    export_findings_payload: Mapped[list[dict]] = mapped_column(
        "export_findings", JSON, nullable=False, default=list
    )
    export_approved_by: Mapped[str] = mapped_column(String(100), nullable=False)
    export_approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    export_destination: Mapped[str | None] = mapped_column(String(255), nullable=True)
    export_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attestation_reviewed_by: Mapped[str] = mapped_column(String(100), nullable=False)
    attestation_review_completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    attestation_client_version: Mapped[str] = mapped_column(String(100), nullable=False)
    attestation_local_bundle_hash: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    attestation_assist_receipt_ids: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list
    )


class OpsEventRecord(Base):
    __tablename__ = "ops_events"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    local_session_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    export_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    assist_receipt_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    actor_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    policy_mode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reviewer_action: Mapped[str | None] = mapped_column(String(100), nullable=True)
