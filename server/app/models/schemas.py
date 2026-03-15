import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Enum as SAEnum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class ReviewSessionRecord(Base):
    __tablename__ = "review_sessions"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    clinician_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    encounter_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    encounter_ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    capture_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    transcript_status: Mapped[str] = mapped_column(String(32), nullable=False)
    review_status: Mapped[str] = mapped_column(String(32), nullable=False)
    export_status: Mapped[str] = mapped_column(String(32), nullable=False)
    consent_recorded_with_consent: Mapped[bool] = mapped_column(
        Boolean, nullable=False
    )
    consent_export_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    consent_captured_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    consent_captured_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    transcript_segments: Mapped[list["TranscriptSegmentRecord"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="TranscriptSegmentRecord.start_offset_ms",
    )
    findings: Mapped[list["FindingRecord"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="FindingRecord.created_at",
    )
    review_decisions: Mapped[list["ReviewDecisionRecord"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ReviewDecisionRecord.reviewed_at",
    )
    approved_exports: Mapped[list["ApprovedExportRecord"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ApprovedExportRecord.approved_at",
    )
    audit_log_entries: Mapped[list["AuditLogEntryRecord"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="AuditLogEntryRecord.timestamp",
    )


class TranscriptSegmentRecord(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("review_sessions.id", ondelete="CASCADE"), nullable=False
    )
    speaker_label: Mapped[str] = mapped_column(String(32), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    start_offset_ms: Mapped[int] = mapped_column(nullable=False)
    end_offset_ms: Mapped[int] = mapped_column(nullable=False)
    transcript_confidence: Mapped[float | None] = mapped_column(nullable=True)
    speaker_confidence: Mapped[float | None] = mapped_column(nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)

    session: Mapped["ReviewSessionRecord"] = relationship(
        back_populates="transcript_segments"
    )


class FindingRecord(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("review_sessions.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(nullable=False)
    evidence_spans: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    detected_by: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    session: Mapped["ReviewSessionRecord"] = relationship(back_populates="findings")
    review_decision: Mapped["ReviewDecisionRecord | None"] = relationship(
        back_populates="finding",
        uselist=False,
    )


class ReviewDecisionRecord(Base):
    __tablename__ = "review_decisions"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("review_sessions.id", ondelete="CASCADE"), nullable=False
    )
    finding_id: Mapped[str] = mapped_column(
        String(100),
        ForeignKey("findings.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    outcome: Mapped[str] = mapped_column(String(32), nullable=False)
    reviewed_by: Mapped[str] = mapped_column(String(100), nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    edited_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    edited_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_evidence_spans: Mapped[list[dict]] = mapped_column(
        JSON, nullable=False, default=list
    )

    session: Mapped["ReviewSessionRecord"] = relationship(
        back_populates="review_decisions"
    )
    finding: Mapped["FindingRecord"] = relationship(back_populates="review_decision")


class ApprovedExportRecord(Base):
    __tablename__ = "approved_exports"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("review_sessions.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    findings_payload: Mapped[list[dict]] = mapped_column(
        "findings", JSON, nullable=False, default=list
    )
    approved_by: Mapped[str] = mapped_column(String(100), nullable=False)
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    destination: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    session: Mapped["ReviewSessionRecord"] = relationship(
        back_populates="approved_exports"
    )


class AuditLogEntryRecord(Base):
    __tablename__ = "audit_log_entries"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("review_sessions.id", ondelete="CASCADE"), nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    details_payload: Mapped[dict] = mapped_column(
        "details", JSON, nullable=False, default=dict
    )

    session: Mapped["ReviewSessionRecord"] = relationship(
        back_populates="audit_log_entries"
    )
