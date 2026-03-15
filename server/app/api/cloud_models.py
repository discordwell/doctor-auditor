from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CaptureMode = Literal["audio_import", "live_capture", "manual_entry"]
FindingStatus = Literal[
    "draft",
    "pending_review",
    "accepted",
    "rejected",
    "uncertain",
    "revised",
]
TranscriptSpeakerLabel = Literal[
    "clinician",
    "patient",
    "caregiver",
    "staff",
    "speaker_a",
    "speaker_b",
    "unknown",
]
OpsEventType = Literal[
    "assist_requested",
    "assist_completed",
    "assist_failed",
    "assist_overridden",
    "redaction_blocked",
    "export_approved",
    "export_sent",
]
SeriousnessDisposition = Literal[
    "routine_review",
    "expedited_human_review",
    "insufficient_context",
]


def _validate_iso8601_timestamp(value: str | None) -> str | None:
    if value is None:
        return None
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


class StrictCloudModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ApprovedEvidenceExcerptModel(StrictCloudModel):
    sourceEvidenceSpanId: str = Field(min_length=1)
    sourceTranscriptSegmentId: str = Field(min_length=1)
    excerpt: str = Field(min_length=1)
    startOffsetMs: int
    endOffsetMs: int


class ApprovedExportFindingModel(StrictCloudModel):
    findingId: str = Field(min_length=1)
    code: str = Field(min_length=1)
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    reviewDecisionId: str = Field(min_length=1)
    evidenceExcerpts: list[ApprovedEvidenceExcerptModel] = Field(default_factory=list)


class ApprovedExportModel(StrictCloudModel):
    id: str = Field(min_length=1)
    sessionId: str = Field(min_length=1)
    status: Literal["draft", "approved", "sent"]
    summary: str = Field(min_length=1)
    findings: list[ApprovedExportFindingModel] = Field(default_factory=list)
    approvedBy: str = Field(min_length=1)
    approvedAt: str
    destination: str | None = None
    sentAt: str | None = None

    @field_validator("approvedAt", "sentAt")
    @classmethod
    def validate_timestamps(cls, value: str | None) -> str | None:
        return _validate_iso8601_timestamp(value)

    @model_validator(mode="after")
    def validate_delivery_state(self) -> "ApprovedExportModel":
        if self.status == "approved" and self.sentAt is not None:
            raise ValueError("sentAt is only allowed when status is 'sent'")
        if self.status == "sent" and self.sentAt is None:
            raise ValueError("sentAt is required when status is 'sent'")
        return self


class ExportSessionMetadataModel(StrictCloudModel):
    localSessionId: str = Field(min_length=1)
    clinicianId: str = Field(min_length=1)
    encounterStartedAt: str
    encounterEndedAt: str | None = None
    captureMode: CaptureMode

    @field_validator("encounterStartedAt", "encounterEndedAt")
    @classmethod
    def validate_timestamps(cls, value: str | None) -> str | None:
        return _validate_iso8601_timestamp(value)


class ExportConsentModel(StrictCloudModel):
    recordedWithConsent: bool
    exportAllowed: bool
    remoteAssistAllowed: bool
    policyVersion: str = Field(min_length=1)


class ExportAttestationModel(StrictCloudModel):
    reviewedBy: str = Field(min_length=1)
    reviewCompletedAt: str
    clientVersion: str = Field(min_length=1)
    localBundleHash: str = Field(min_length=1)
    assistReceiptIds: list[str] = Field(default_factory=list)

    @field_validator("reviewCompletedAt")
    @classmethod
    def validate_timestamps(cls, value: str) -> str:
        return _validate_iso8601_timestamp(value) or value


class ApprovedExportEnvelopeModel(StrictCloudModel):
    id: str = Field(min_length=1)
    organizationId: str | None = None
    session: ExportSessionMetadataModel
    consent: ExportConsentModel
    export: ApprovedExportModel
    attestation: ExportAttestationModel

    @model_validator(mode="after")
    def validate_cross_references(self) -> "ApprovedExportEnvelopeModel":
        if self.export.id != self.id:
            raise ValueError("export id must match envelope id")
        if self.export.sessionId != self.session.localSessionId:
            raise ValueError(
                "export sessionId must match session.localSessionId"
            )
        if not self.consent.remoteAssistAllowed and self.attestation.assistReceiptIds:
            raise ValueError(
                "assistReceiptIds are only allowed when remoteAssistAllowed is true"
            )
        return self


class OpsEventModel(StrictCloudModel):
    id: str = Field(min_length=1)
    organizationId: str | None = None
    localSessionId: str = Field(min_length=1)
    exportId: str | None = None
    assistReceiptId: str | None = None
    type: OpsEventType
    recordedAt: str
    actorId: str | None = None
    provider: str | None = None
    model: str | None = None
    policyMode: str | None = None
    latencyMs: int | None = None
    errorCode: str | None = None
    reviewerAction: str | None = None

    @field_validator("recordedAt")
    @classmethod
    def validate_timestamps(cls, value: str) -> str:
        return _validate_iso8601_timestamp(value) or value

    @model_validator(mode="after")
    def validate_context_requirements(self) -> "OpsEventModel":
        if self.type in {
            "assist_requested",
            "assist_completed",
            "assist_failed",
            "assist_overridden",
        } and not self.assistReceiptId:
            raise ValueError("assistReceiptId is required for assist events")
        if self.type in {"export_approved", "export_sent"} and not self.exportId:
            raise ValueError("exportId is required for export events")
        return self


class OpsSummaryModel(StrictCloudModel):
    totalExports: int
    approvedExports: int
    sentExports: int
    assistUsageCount: int
    assistOverrideCount: int
    redactionBlockCount: int
    averageSendLatencyMs: float | None = None


class MinimizedConcernPacketModel(StrictCloudModel):
    findingCode: str = Field(min_length=1)
    findingStatus: FindingStatus
    findingConfidence: float = Field(ge=0, le=1)
    evidenceSpanCount: int = Field(ge=0)
    speakerLabels: list[TranscriptSpeakerLabel] = Field(default_factory=list)
    captureMode: CaptureMode
    encounterDurationMs: int | None = Field(default=None, ge=0)


class AssistGatewayRequestModel(StrictCloudModel):
    id: str = Field(min_length=1)
    sessionId: str = Field(min_length=1)
    findingId: str | None = None
    requestedBy: str = Field(min_length=1)
    requestedAt: str
    policyVersion: str = Field(min_length=1)
    policyMode: Literal["minimized_no_raw_phi"]
    concern: MinimizedConcernPacketModel

    @field_validator("requestedAt")
    @classmethod
    def validate_timestamps(cls, value: str) -> str:
        return _validate_iso8601_timestamp(value) or value


class SeriousnessAssessmentModel(StrictCloudModel):
    disposition: SeriousnessDisposition
    confidence: float = Field(ge=0, le=1)
    rationale: str = Field(min_length=1)
    limitations: list[str] = Field(default_factory=list)
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    assessedAt: str

    @field_validator("assessedAt")
    @classmethod
    def validate_timestamps(cls, value: str) -> str:
        return _validate_iso8601_timestamp(value) or value
