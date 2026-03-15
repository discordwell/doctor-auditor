import uuid
from datetime import datetime
from sqlalchemy import String, Float, DateTime, ForeignKey, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from app.models.database import Base
import enum


class UserRole(str, enum.Enum):
    underwriter = "underwriter"
    admin = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    specialty: Mapped[str | None] = mapped_column(String(100), nullable=True)
    department_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    assessments: Mapped[list["RiskAssessmentRecord"]] = relationship(back_populates="doctor")


class RiskAssessmentRecord(Base):
    __tablename__ = "risk_assessments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    doctor_id: Mapped[str] = mapped_column(String(100), ForeignKey("doctors.id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    duration: Mapped[float] = mapped_column(Float, nullable=False)

    communication_score: Mapped[float] = mapped_column(Float, nullable=False)
    communication_flags: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    clinical_score: Mapped[float] = mapped_column(Float, nullable=False)
    clinical_flags: Mapped[str] = mapped_column(Text, nullable=False)
    behavioral_score: Mapped[float] = mapped_column(Float, nullable=False)
    behavioral_flags: Mapped[str] = mapped_column(Text, nullable=False)

    overall_score: Mapped[float] = mapped_column(Float, nullable=False)
    overall_risk: Mapped[str] = mapped_column(String(10), nullable=False)
    analysis_source: Mapped[str] = mapped_column(String(10), nullable=False)

    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    doctor: Mapped["Doctor"] = relationship(back_populates="assessments")
