from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CaptureMode = Literal["audio_import", "live_capture", "manual_entry"]
TranscriptStatus = Literal["not_started", "in_progress", "completed", "failed"]
ReviewStatus = Literal["not_started", "ready", "in_review", "completed"]
ExportStatus = Literal["not_requested", "draft", "approved", "sent"]
FindingStatus = Literal[
    "draft",
    "pending_review",
    "accepted",
    "rejected",
    "uncertain",
    "revised",
]
ReviewDecisionOutcome = Literal["accepted", "rejected", "uncertain", "edited"]
FindingSource = Literal["rules", "local_llm", "cloud_llm", "human"]
TranscriptSpeakerLabel = Literal[
    "clinician",
    "patient",
    "caregiver",
    "staff",
    "speaker_a",
    "speaker_b",
    "unknown",
]
TranscriptSource = Literal["audio_import", "live_capture", "manual_edit"]
AuditAction = Literal[
    "session_created",
    "audio_imported",
    "transcript_viewed",
    "finding_reviewed",
    "export_approved",
    "export_sent",
]


class SessionConsentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recordedWithConsent: bool
    exportAllowed: bool
    capturedAt: str | None = None
    capturedBy: str | None = None


class ReviewSessionModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    clinicianId: str
    organizationId: str | None = None
    encounterStartedAt: str
    encounterEndedAt: str | None = None
    captureMode: CaptureMode
    transcriptStatus: TranscriptStatus
    reviewStatus: ReviewStatus
    exportStatus: ExportStatus
    createdAt: str
    updatedAt: str
    consent: SessionConsentModel


class TranscriptSegmentModel(BaseModel):
    id: str
    sessionId: str
    speakerLabel: TranscriptSpeakerLabel
    text: str
    startOffsetMs: int
    endOffsetMs: int
    transcriptConfidence: float | None = None
    speakerConfidence: float | None = None
    source: TranscriptSource


class EvidenceSpanModel(BaseModel):
    id: str
    transcriptSegmentId: str
    excerpt: str
    startOffsetMs: int
    endOffsetMs: int
    startTextOffset: int | None = None
    endTextOffset: int | None = None


class FindingModel(BaseModel):
    id: str
    sessionId: str
    code: str
    title: str
    summary: str
    status: FindingStatus
    confidence: float
    evidenceSpans: list[EvidenceSpanModel] = Field(default_factory=list)
    detectedBy: FindingSource
    createdAt: str
    updatedAt: str
    reviewDecisionId: str | None = None


class ReviewDecisionModel(BaseModel):
    id: str
    sessionId: str
    findingId: str
    outcome: ReviewDecisionOutcome
    reviewedBy: str
    reviewedAt: str
    rationale: str | None = None
    editedTitle: str | None = None
    editedSummary: str | None = None
    approvedEvidenceSpans: list[EvidenceSpanModel] | None = None


class ApprovedEvidenceExcerptModel(BaseModel):
    sourceEvidenceSpanId: str
    sourceTranscriptSegmentId: str
    excerpt: str
    startOffsetMs: int
    endOffsetMs: int


class ApprovedExportFindingModel(BaseModel):
    findingId: str
    code: str
    title: str
    summary: str
    reviewDecisionId: str
    evidenceExcerpts: list[ApprovedEvidenceExcerptModel] = Field(default_factory=list)


class ApprovedExportModel(BaseModel):
    id: str
    sessionId: str
    status: Literal["draft", "approved", "sent"]
    summary: str
    findings: list[ApprovedExportFindingModel] = Field(default_factory=list)
    approvedBy: str
    approvedAt: str
    destination: str | None = None
    sentAt: str | None = None


def _validate_iso8601_timestamp(value: str | None) -> str | None:
    if value is None:
        return None
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


class StrictApprovedExportRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ApprovedEvidenceExcerptRequestModel(StrictApprovedExportRequestModel):
    sourceEvidenceSpanId: str = Field(min_length=1)
    sourceTranscriptSegmentId: str = Field(min_length=1)
    excerpt: str = Field(min_length=1)
    startOffsetMs: int
    endOffsetMs: int


class ApprovedExportFindingRequestModel(StrictApprovedExportRequestModel):
    findingId: str = Field(min_length=1)
    code: str = Field(min_length=1)
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    reviewDecisionId: str = Field(min_length=1)
    evidenceExcerpts: list[ApprovedEvidenceExcerptRequestModel] = Field(
        default_factory=list
    )


class ApprovedExportIngestRequest(StrictApprovedExportRequestModel):
    id: str = Field(min_length=1)
    sessionId: str = Field(min_length=1)
    status: Literal["approved", "sent"]
    summary: str = Field(min_length=1)
    findings: list[ApprovedExportFindingRequestModel] = Field(default_factory=list)
    approvedBy: str = Field(min_length=1)
    approvedAt: str
    destination: str | None = None
    sentAt: str | None = None

    @field_validator("approvedAt", "sentAt")
    @classmethod
    def validate_timestamps(cls, value: str | None) -> str | None:
        return _validate_iso8601_timestamp(value)

    @model_validator(mode="after")
    def validate_delivery_state(self) -> "ApprovedExportIngestRequest":
        if self.status == "approved" and self.sentAt is not None:
            raise ValueError("sentAt is only allowed when status is 'sent'")
        if self.status == "sent" and self.sentAt is None:
            raise ValueError("sentAt is required when status is 'sent'")
        return self


class AuditLogEntryModel(BaseModel):
    id: str
    sessionId: str
    timestamp: str
    action: AuditAction
    actorId: str | None = None
    details: dict[str, object] = Field(default_factory=dict)


class SessionBundleModel(BaseModel):
    session: ReviewSessionModel
    transcriptSegments: list[TranscriptSegmentModel] = Field(default_factory=list)
    findings: list[FindingModel] = Field(default_factory=list)
    reviewDecisions: list[ReviewDecisionModel] = Field(default_factory=list)
    approvedExports: list[ApprovedExportModel] = Field(default_factory=list)
    auditLogEntries: list[AuditLogEntryModel] = Field(default_factory=list)


class ReviewDecisionCreateRequest(BaseModel):
    outcome: ReviewDecisionOutcome
    reviewedBy: str
    rationale: str | None = None
    editedTitle: str | None = None
    editedSummary: str | None = None
    approvedEvidenceSpans: list[EvidenceSpanModel] | None = None
