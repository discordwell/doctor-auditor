from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.review_models import (
    ApprovedExportIngestRequest,
    ApprovedExportModel,
    AuditLogEntryModel,
    EvidenceSpanModel,
    FindingModel,
    ReviewDecisionCreateRequest,
    ReviewDecisionModel,
    ReviewSessionModel,
    SessionConsentModel,
    TranscriptSegmentModel,
)
from app.models.schemas import (
    ApprovedExportRecord,
    AuditLogEntryRecord,
    FindingRecord,
    ReviewDecisionRecord,
    ReviewSessionRecord,
    TranscriptSegmentRecord,
)


_SESSION_BUNDLE_LOADERS = (
    selectinload(ReviewSessionRecord.transcript_segments),
    selectinload(ReviewSessionRecord.findings).selectinload(FindingRecord.review_decision),
    selectinload(ReviewSessionRecord.review_decisions),
    selectinload(ReviewSessionRecord.approved_exports),
    selectinload(ReviewSessionRecord.audit_log_entries),
)

_APPROVED_EXPORT_OUTCOMES = {"accepted", "edited"}


class ApprovedExportIngestError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def current_organization_id(token: dict) -> str:
    return str(token.get("org") or token.get("organization_id") or "demo-health")


def _parse_timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _serialize_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _decision_status(outcome: str) -> str:
    return {
        "accepted": "accepted",
        "rejected": "rejected",
        "uncertain": "uncertain",
        "edited": "revised",
    }.get(outcome, "pending_review")


def _serialize_evidence_spans(payload: list[dict] | None) -> list[EvidenceSpanModel]:
    return [EvidenceSpanModel.model_validate(item) for item in payload or []]


def _review_session_model(record: ReviewSessionRecord) -> ReviewSessionModel:
    return ReviewSessionModel(
        id=record.id,
        clinicianId=record.clinician_id,
        organizationId=record.organization_id,
        encounterStartedAt=_serialize_timestamp(record.encounter_started_at) or "",
        encounterEndedAt=_serialize_timestamp(record.encounter_ended_at),
        captureMode=record.capture_mode,
        transcriptStatus=record.transcript_status,
        reviewStatus=record.review_status,
        exportStatus=record.export_status,
        createdAt=_serialize_timestamp(record.created_at) or "",
        updatedAt=_serialize_timestamp(record.updated_at) or "",
        consent=SessionConsentModel(
            recordedWithConsent=record.consent_recorded_with_consent,
            exportAllowed=record.consent_export_allowed,
            capturedAt=_serialize_timestamp(record.consent_captured_at),
            capturedBy=record.consent_captured_by,
        ),
    )


def _apply_review_session_payload(
    record: ReviewSessionRecord,
    organization_id: str,
    session_payload: ReviewSessionModel,
) -> None:
    record.clinician_id = session_payload.clinicianId
    record.organization_id = organization_id
    record.encounter_started_at = (
        _parse_timestamp(session_payload.encounterStartedAt)
        or datetime.now(timezone.utc)
    )
    record.encounter_ended_at = _parse_timestamp(session_payload.encounterEndedAt)
    record.capture_mode = session_payload.captureMode
    record.transcript_status = session_payload.transcriptStatus
    record.review_status = session_payload.reviewStatus
    record.export_status = session_payload.exportStatus
    record.created_at = _parse_timestamp(session_payload.createdAt) or datetime.now(
        timezone.utc
    )
    record.updated_at = _parse_timestamp(session_payload.updatedAt) or datetime.now(
        timezone.utc
    )
    record.consent_recorded_with_consent = (
        session_payload.consent.recordedWithConsent
    )
    record.consent_export_allowed = session_payload.consent.exportAllowed
    record.consent_captured_at = _parse_timestamp(session_payload.consent.capturedAt)
    record.consent_captured_by = session_payload.consent.capturedBy


def _transcript_segment_model(
    record: TranscriptSegmentRecord,
) -> TranscriptSegmentModel:
    return TranscriptSegmentModel(
        id=record.id,
        sessionId=record.session_id,
        speakerLabel=record.speaker_label,
        text=record.text,
        startOffsetMs=record.start_offset_ms,
        endOffsetMs=record.end_offset_ms,
        transcriptConfidence=record.transcript_confidence,
        speakerConfidence=record.speaker_confidence,
        source=record.source,
    )


def _finding_model(record: FindingRecord) -> FindingModel:
    return FindingModel(
        id=record.id,
        sessionId=record.session_id,
        code=record.code,
        title=record.title,
        summary=record.summary,
        status=record.status,
        confidence=record.confidence,
        evidenceSpans=_serialize_evidence_spans(record.evidence_spans),
        detectedBy=record.detected_by,
        createdAt=_serialize_timestamp(record.created_at) or "",
        updatedAt=_serialize_timestamp(record.updated_at) or "",
        reviewDecisionId=(
            record.review_decision.id if record.review_decision is not None else None
        ),
    )


def _review_decision_model(record: ReviewDecisionRecord) -> ReviewDecisionModel:
    return ReviewDecisionModel(
        id=record.id,
        sessionId=record.session_id,
        findingId=record.finding_id,
        outcome=record.outcome,
        reviewedBy=record.reviewed_by,
        reviewedAt=_serialize_timestamp(record.reviewed_at) or "",
        rationale=record.rationale,
        editedTitle=record.edited_title,
        editedSummary=record.edited_summary,
        approvedEvidenceSpans=_serialize_evidence_spans(record.approved_evidence_spans),
    )


def _approved_export_model(record: ApprovedExportRecord) -> ApprovedExportModel:
    return ApprovedExportModel.model_validate(
        {
            "id": record.id,
            "sessionId": record.session_id,
            "status": record.status,
            "summary": record.summary,
            "findings": record.findings_payload or [],
            "approvedBy": record.approved_by,
            "approvedAt": _serialize_timestamp(record.approved_at),
            "destination": record.destination,
            "sentAt": _serialize_timestamp(record.sent_at),
        }
    )


def _audit_log_model(record: AuditLogEntryRecord) -> AuditLogEntryModel:
    return AuditLogEntryModel(
        id=record.id,
        sessionId=record.session_id,
        timestamp=_serialize_timestamp(record.timestamp) or "",
        action=record.action,
        actorId=record.actor_id,
        details=record.details_payload or {},
    )


def _transcript_segment_record(
    payload: TranscriptSegmentModel,
) -> TranscriptSegmentRecord:
    return TranscriptSegmentRecord(
        id=payload.id,
        session_id=payload.sessionId,
        speaker_label=payload.speakerLabel,
        text=payload.text,
        start_offset_ms=payload.startOffsetMs,
        end_offset_ms=payload.endOffsetMs,
        transcript_confidence=payload.transcriptConfidence,
        speaker_confidence=payload.speakerConfidence,
        source=payload.source,
    )


def _finding_record(payload: FindingModel) -> FindingRecord:
    return FindingRecord(
        id=payload.id,
        session_id=payload.sessionId,
        code=payload.code,
        title=payload.title,
        summary=payload.summary,
        status=payload.status,
        confidence=payload.confidence,
        evidence_spans=[item.model_dump() for item in payload.evidenceSpans],
        detected_by=payload.detectedBy,
        created_at=_parse_timestamp(payload.createdAt) or datetime.now(timezone.utc),
        updated_at=_parse_timestamp(payload.updatedAt) or datetime.now(timezone.utc),
    )


def _review_decision_record(
    payload: ReviewDecisionModel,
) -> ReviewDecisionRecord:
    return ReviewDecisionRecord(
        id=payload.id,
        session_id=payload.sessionId,
        finding_id=payload.findingId,
        outcome=payload.outcome,
        reviewed_by=payload.reviewedBy,
        reviewed_at=_parse_timestamp(payload.reviewedAt) or datetime.now(timezone.utc),
        rationale=payload.rationale,
        edited_title=payload.editedTitle,
        edited_summary=payload.editedSummary,
        approved_evidence_spans=[
            item.model_dump() for item in payload.approvedEvidenceSpans or []
        ],
    )


def _approved_export_record(
    payload: ApprovedExportModel,
) -> ApprovedExportRecord:
    return ApprovedExportRecord(
        id=payload.id,
        session_id=payload.sessionId,
        status=payload.status,
        summary=payload.summary,
        findings_payload=[item.model_dump() for item in payload.findings],
        approved_by=payload.approvedBy,
        approved_at=_parse_timestamp(payload.approvedAt) or datetime.now(timezone.utc),
        destination=payload.destination,
        sent_at=_parse_timestamp(payload.sentAt),
    )


def _audit_log_record(payload: AuditLogEntryModel) -> AuditLogEntryRecord:
    return AuditLogEntryRecord(
        id=payload.id,
        session_id=payload.sessionId,
        timestamp=_parse_timestamp(payload.timestamp) or datetime.now(timezone.utc),
        action=payload.action,
        actor_id=payload.actorId,
        details_payload=payload.details,
    )


async def _session_record(
    db: AsyncSession,
    organization_id: str,
    session_id: str,
) -> ReviewSessionRecord | None:
    result = await db.execute(
        select(ReviewSessionRecord).where(
            ReviewSessionRecord.id == session_id,
            ReviewSessionRecord.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def _session_record_with_related(
    db: AsyncSession,
    organization_id: str,
    session_id: str,
) -> ReviewSessionRecord | None:
    result = await db.execute(
        select(ReviewSessionRecord)
        .options(*_SESSION_BUNDLE_LOADERS)
        .where(
            ReviewSessionRecord.id == session_id,
            ReviewSessionRecord.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def list_sessions(
    db: AsyncSession,
    organization_id: str,
    review_status: str | None = None,
    export_status: str | None = None,
    clinician_id: str | None = None,
) -> list[ReviewSessionModel]:
    query = (
        select(ReviewSessionRecord)
        .where(ReviewSessionRecord.organization_id == organization_id)
        .order_by(ReviewSessionRecord.created_at.desc())
    )

    if review_status:
        query = query.where(ReviewSessionRecord.review_status == review_status)
    if export_status:
        query = query.where(ReviewSessionRecord.export_status == export_status)
    if clinician_id:
        query = query.where(ReviewSessionRecord.clinician_id == clinician_id)

    result = await db.execute(query)
    return [_review_session_model(record) for record in result.scalars().all()]


async def get_session(
    db: AsyncSession,
    organization_id: str,
    session_id: str,
) -> ReviewSessionModel | None:
    record = await _session_record(db, organization_id, session_id)
    if record is None:
        return None
    return _review_session_model(record)


async def upsert_session(
    db: AsyncSession,
    organization_id: str,
    payload: ReviewSessionModel,
) -> ReviewSessionModel:
    record = await _session_record(db, organization_id, payload.id)

    if record is None:
        record = ReviewSessionRecord(id=payload.id)
        db.add(record)

    _apply_review_session_payload(record, organization_id, payload)

    await db.commit()
    await db.refresh(record)
    return _review_session_model(record)


async def list_findings(
    db: AsyncSession,
    organization_id: str,
    session_id: str | None = None,
    status: str | None = None,
) -> list[FindingModel]:
    query = (
        select(FindingRecord)
        .join(ReviewSessionRecord)
        .options(selectinload(FindingRecord.review_decision))
        .where(ReviewSessionRecord.organization_id == organization_id)
        .order_by(FindingRecord.updated_at.desc())
    )

    if session_id:
        query = query.where(FindingRecord.session_id == session_id)
    if status:
        query = query.where(FindingRecord.status == status)

    result = await db.execute(query)
    return [_finding_model(record) for record in result.scalars().all()]


async def get_finding(
    db: AsyncSession,
    organization_id: str,
    finding_id: str,
) -> FindingModel | None:
    result = await db.execute(
        select(FindingRecord)
        .join(ReviewSessionRecord)
        .options(selectinload(FindingRecord.review_decision))
        .where(
            FindingRecord.id == finding_id,
            ReviewSessionRecord.organization_id == organization_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    return _finding_model(record)


async def create_review_decision(
    db: AsyncSession,
    organization_id: str,
    finding_id: str,
    payload: ReviewDecisionCreateRequest,
) -> ReviewDecisionModel | None:
    result = await db.execute(
        select(FindingRecord)
        .join(ReviewSessionRecord)
        .options(
            selectinload(FindingRecord.review_decision),
            selectinload(FindingRecord.session).selectinload(ReviewSessionRecord.findings),
        )
        .where(
            FindingRecord.id == finding_id,
            ReviewSessionRecord.organization_id == organization_id,
        )
    )
    finding = result.scalar_one_or_none()
    if finding is None:
        return None

    reviewed_at = datetime.now(timezone.utc)
    decision = finding.review_decision
    if decision is None:
        decision = ReviewDecisionRecord(
            id=f"decision-{uuid4().hex[:10]}",
            session_id=finding.session_id,
            finding_id=finding.id,
        )
        db.add(decision)

    decision.outcome = payload.outcome
    decision.reviewed_by = payload.reviewedBy
    decision.reviewed_at = reviewed_at
    decision.rationale = payload.rationale
    decision.edited_title = payload.editedTitle
    decision.edited_summary = payload.editedSummary
    decision.approved_evidence_spans = [
        item.model_dump()
        for item in (
            payload.approvedEvidenceSpans
            if payload.approvedEvidenceSpans is not None
            else _serialize_evidence_spans(finding.evidence_spans)
        )
    ]

    finding.status = _decision_status(payload.outcome)
    finding.updated_at = reviewed_at

    pending_statuses = {"draft", "pending_review"}
    has_pending_findings = any(
        item.id != finding.id and item.status in pending_statuses
        for item in finding.session.findings
    )
    finding.session.review_status = "completed" if not has_pending_findings else "in_review"
    finding.session.updated_at = reviewed_at

    db.add(
        AuditLogEntryRecord(
            id=f"audit-{uuid4().hex[:10]}",
            session_id=finding.session_id,
            timestamp=reviewed_at,
            action="finding_reviewed",
            actor_id=payload.reviewedBy,
            details_payload={"findingId": finding.id, "outcome": payload.outcome},
        )
    )

    await db.commit()
    await db.refresh(decision)
    return _review_decision_model(decision)


async def list_approved_exports(
    db: AsyncSession,
    organization_id: str,
    session_id: str | None = None,
    status: str | None = None,
) -> list[ApprovedExportModel]:
    query = (
        select(ApprovedExportRecord)
        .join(ReviewSessionRecord)
        .where(ReviewSessionRecord.organization_id == organization_id)
        .order_by(ApprovedExportRecord.approved_at.desc())
    )

    if session_id:
        query = query.where(ApprovedExportRecord.session_id == session_id)
    if status:
        query = query.where(ApprovedExportRecord.status == status)

    result = await db.execute(query)
    return [_approved_export_model(record) for record in result.scalars().all()]


async def get_approved_export(
    db: AsyncSession,
    organization_id: str,
    export_id: str,
) -> ApprovedExportModel | None:
    result = await db.execute(
        select(ApprovedExportRecord)
        .join(ReviewSessionRecord)
        .where(
            ApprovedExportRecord.id == export_id,
            ReviewSessionRecord.organization_id == organization_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    return _approved_export_model(record)


def _validate_approved_export_payload(
    session: ReviewSessionRecord,
    payload: ApprovedExportIngestRequest,
) -> None:
    if not session.consent_export_allowed:
        raise ApprovedExportIngestError(
            status_code=400,
            detail="session consent does not allow approved export ingestion",
        )

    if session.review_status != "completed":
        raise ApprovedExportIngestError(
            status_code=409,
            detail="session review must be completed before ingesting an approved export",
        )

    findings_by_id = {item.id: item for item in session.findings}
    decisions_by_id = {item.id: item for item in session.review_decisions}
    seen_finding_ids: set[str] = set()

    for exported_finding in payload.findings:
        if exported_finding.findingId in seen_finding_ids:
            raise ApprovedExportIngestError(
                status_code=400,
                detail=(
                    "approved export findings must not include duplicate "
                    f"finding ids: '{exported_finding.findingId}'"
                ),
            )
        seen_finding_ids.add(exported_finding.findingId)

        finding = findings_by_id.get(exported_finding.findingId)
        if finding is None:
            raise ApprovedExportIngestError(
                status_code=400,
                detail=(
                    "approved export findings must reference findings from the "
                    f"session: '{exported_finding.findingId}'"
                ),
            )

        decision = decisions_by_id.get(exported_finding.reviewDecisionId)
        if decision is None:
            raise ApprovedExportIngestError(
                status_code=400,
                detail=(
                    "approved export findings must reference stored review decisions: "
                    f"'{exported_finding.reviewDecisionId}'"
                ),
            )

        if decision.finding_id != finding.id:
            raise ApprovedExportIngestError(
                status_code=400,
                detail=(
                    "approved export review decisions must match their finding ids: "
                    f"'{exported_finding.reviewDecisionId}'"
                ),
            )

        if decision.outcome not in _APPROVED_EXPORT_OUTCOMES:
            raise ApprovedExportIngestError(
                status_code=400,
                detail=(
                    "approved export findings must reference accepted or edited "
                    "review decisions"
                ),
            )

        approved_spans = {
            span.id: span
            for span in _serialize_evidence_spans(decision.approved_evidence_spans)
        }
        for evidence_excerpt in exported_finding.evidenceExcerpts:
            approved_span = approved_spans.get(evidence_excerpt.sourceEvidenceSpanId)
            if approved_span is None:
                raise ApprovedExportIngestError(
                    status_code=400,
                    detail=(
                        "approved export evidence must reference approved evidence "
                        f"spans: '{evidence_excerpt.sourceEvidenceSpanId}'"
                    ),
                )
            if (
                approved_span.transcriptSegmentId
                != evidence_excerpt.sourceTranscriptSegmentId
            ):
                raise ApprovedExportIngestError(
                    status_code=400,
                    detail=(
                        "approved export evidence excerpts must keep transcript "
                        "segment references aligned with approved evidence spans"
                    ),
                )


async def ingest_approved_export(
    db: AsyncSession,
    organization_id: str,
    payload: ApprovedExportIngestRequest,
) -> ApprovedExportModel:
    session = await _session_record_with_related(db, organization_id, payload.sessionId)
    if session is None:
        raise ApprovedExportIngestError(
            status_code=404,
            detail=f"Session '{payload.sessionId}' was not found for the approved export",
        )

    _validate_approved_export_payload(session, payload)

    result = await db.execute(
        select(ApprovedExportRecord)
        .join(ReviewSessionRecord)
        .where(
            ApprovedExportRecord.id == payload.id,
            ReviewSessionRecord.organization_id == organization_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        record = ApprovedExportRecord(id=payload.id, session_id=payload.sessionId)
        db.add(record)

    record.session_id = payload.sessionId
    record.status = payload.status
    record.summary = payload.summary
    record.findings_payload = [item.model_dump() for item in payload.findings]
    record.approved_by = payload.approvedBy
    record.approved_at = _parse_timestamp(payload.approvedAt) or datetime.now(
        timezone.utc
    )
    record.destination = payload.destination
    record.sent_at = _parse_timestamp(payload.sentAt)

    session.export_status = payload.status
    session.updated_at = datetime.now(timezone.utc)

    db.add(
        AuditLogEntryRecord(
            id=f"audit-{uuid4().hex[:10]}",
            session_id=session.id,
            timestamp=session.updated_at,
            action="export_sent" if payload.status == "sent" else "export_approved",
            actor_id=payload.approvedBy,
            details_payload={
                "exportId": payload.id,
                "status": payload.status,
                "destination": payload.destination,
            },
        )
    )

    await db.commit()
    refreshed = await get_approved_export(db, organization_id, payload.id)
    if refreshed is None:
        raise RuntimeError("approved export could not be reloaded after persistence")
    return refreshed
