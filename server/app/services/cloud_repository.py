from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.cloud_models import (
    ApprovedExportEnvelopeModel,
    OpsEventModel,
    OpsSummaryModel,
)
from app.models.schemas import ApprovedExportRecord, OpsEventRecord


class ApprovedExportIngestError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class OpsEventIngestError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def current_organization_id(token: dict) -> str:
    organization_id = token.get("org") or token.get("organization_id")
    if organization_id is None:
        raise ValueError("authenticated token missing organization claim")
    return str(organization_id)


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


def _approved_export_model(record: ApprovedExportRecord) -> ApprovedExportEnvelopeModel:
    return ApprovedExportEnvelopeModel.model_validate(
        {
            "id": record.id,
            "organizationId": record.organization_id,
            "session": {
                "localSessionId": record.local_session_id,
                "clinicianId": record.clinician_id,
                "encounterStartedAt": _serialize_timestamp(
                    record.encounter_started_at
                ),
                "encounterEndedAt": _serialize_timestamp(record.encounter_ended_at),
                "captureMode": record.capture_mode,
            },
            "consent": {
                "recordedWithConsent": record.consent_recorded_with_consent,
                "exportAllowed": record.consent_export_allowed,
                "remoteAssistAllowed": record.consent_remote_assist_allowed,
                "policyVersion": record.consent_policy_version,
            },
            "export": {
                "id": record.id,
                "sessionId": record.local_session_id,
                "status": record.export_status,
                "summary": record.export_summary,
                "findings": record.export_findings_payload or [],
                "approvedBy": record.export_approved_by,
                "approvedAt": _serialize_timestamp(record.export_approved_at),
                "destination": record.export_destination,
                "sentAt": _serialize_timestamp(record.export_sent_at),
            },
            "attestation": {
                "reviewedBy": record.attestation_reviewed_by,
                "reviewCompletedAt": _serialize_timestamp(
                    record.attestation_review_completed_at
                ),
                "clientVersion": record.attestation_client_version,
                "localBundleHash": record.attestation_local_bundle_hash,
                "assistReceiptIds": record.attestation_assist_receipt_ids or [],
            },
        }
    )


def _ops_event_model(record: OpsEventRecord) -> OpsEventModel:
    return OpsEventModel(
        id=record.id,
        organizationId=record.organization_id,
        localSessionId=record.local_session_id,
        exportId=record.export_id,
        assistReceiptId=record.assist_receipt_id,
        type=record.event_type,
        recordedAt=_serialize_timestamp(record.recorded_at) or "",
        actorId=record.actor_id,
        provider=record.provider,
        model=record.model_name,
        policyMode=record.policy_mode,
        latencyMs=record.latency_ms,
        errorCode=record.error_code,
        reviewerAction=record.reviewer_action,
        assessment=record.assessment_payload,
    )


async def list_approved_exports(
    db: AsyncSession,
    organization_id: str,
    status: str | None = None,
    clinician_id: str | None = None,
) -> list[ApprovedExportEnvelopeModel]:
    query = (
        select(ApprovedExportRecord)
        .where(ApprovedExportRecord.organization_id == organization_id)
        .order_by(ApprovedExportRecord.export_approved_at.desc())
    )

    if status:
        query = query.where(ApprovedExportRecord.export_status == status)
    if clinician_id:
        query = query.where(ApprovedExportRecord.clinician_id == clinician_id)

    result = await db.execute(query)
    return [_approved_export_model(record) for record in result.scalars().all()]


async def get_approved_export(
    db: AsyncSession,
    organization_id: str,
    export_id: str,
) -> ApprovedExportEnvelopeModel | None:
    result = await db.execute(
        select(ApprovedExportRecord).where(
            ApprovedExportRecord.id == export_id,
            ApprovedExportRecord.organization_id == organization_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    return _approved_export_model(record)


async def ingest_approved_export(
    db: AsyncSession,
    organization_id: str,
    payload: ApprovedExportEnvelopeModel,
) -> ApprovedExportEnvelopeModel:
    if payload.organizationId not in {None, organization_id}:
        raise ApprovedExportIngestError(
            status_code=400,
            detail="export organization does not match authenticated organization",
        )

    if not payload.consent.recordedWithConsent:
        raise ApprovedExportIngestError(
            status_code=400,
            detail="recordedWithConsent must be true for approved export ingestion",
        )

    if not payload.consent.exportAllowed:
        raise ApprovedExportIngestError(
            status_code=400,
            detail="exportAllowed must be true for approved export ingestion",
        )

    result = await db.execute(
        select(ApprovedExportRecord).where(
            ApprovedExportRecord.id == payload.id,
            ApprovedExportRecord.organization_id == organization_id,
        )
    )
    record = result.scalar_one_or_none()

    if record is None:
        record = ApprovedExportRecord(id=payload.id, organization_id=organization_id)
        db.add(record)

    record.organization_id = organization_id
    record.local_session_id = payload.session.localSessionId
    record.clinician_id = payload.session.clinicianId
    record.encounter_started_at = _parse_timestamp(payload.session.encounterStartedAt)
    record.encounter_ended_at = _parse_timestamp(payload.session.encounterEndedAt)
    record.capture_mode = payload.session.captureMode
    record.consent_recorded_with_consent = payload.consent.recordedWithConsent
    record.consent_export_allowed = payload.consent.exportAllowed
    record.consent_remote_assist_allowed = payload.consent.remoteAssistAllowed
    record.consent_policy_version = payload.consent.policyVersion
    record.export_status = payload.export.status
    record.export_summary = payload.export.summary
    record.export_findings_payload = [
        item.model_dump() for item in payload.export.findings
    ]
    record.export_approved_by = payload.export.approvedBy
    record.export_approved_at = _parse_timestamp(payload.export.approvedAt) or datetime.now(
        timezone.utc
    )
    record.export_destination = payload.export.destination
    record.export_sent_at = _parse_timestamp(payload.export.sentAt)
    record.attestation_reviewed_by = payload.attestation.reviewedBy
    record.attestation_review_completed_at = (
        _parse_timestamp(payload.attestation.reviewCompletedAt) or datetime.now(timezone.utc)
    )
    record.attestation_client_version = payload.attestation.clientVersion
    record.attestation_local_bundle_hash = payload.attestation.localBundleHash
    record.attestation_assist_receipt_ids = payload.attestation.assistReceiptIds

    # The id is the global primary key, but the existence check above is
    # org-scoped. If another organization already owns this id, the org-scoped
    # lookup misses and a colliding INSERT would surface as an opaque 500. Turn
    # that into a deterministic 409 instead of leaking the IntegrityError.
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ApprovedExportIngestError(
            status_code=409,
            detail=f"an approved export with id '{payload.id}' already exists",
        ) from exc

    refreshed = await get_approved_export(db, organization_id, payload.id)
    if refreshed is None:
        raise RuntimeError("approved export could not be reloaded after persistence")
    return refreshed


async def release_approved_export(
    db: AsyncSession,
    organization_id: str,
    export_id: str,
    actor_id: str | None = None,
) -> ApprovedExportEnvelopeModel:
    result = await db.execute(
        select(ApprovedExportRecord).where(
            ApprovedExportRecord.id == export_id,
            ApprovedExportRecord.organization_id == organization_id,
        )
    )
    record = result.scalar_one_or_none()

    if record is None:
        raise ApprovedExportIngestError(
            status_code=404,
            detail=f"Approved export '{export_id}' was not found",
        )

    if record.export_status == "sent":
        return _approved_export_model(record)

    if record.export_status != "approved":
        raise ApprovedExportIngestError(
            status_code=409,
            detail="only approved exports can be released",
        )

    sent_at = datetime.now(timezone.utc)
    record.export_status = "sent"
    record.export_sent_at = sent_at
    db.add(
        OpsEventRecord(
            id=f"ops-release-{uuid4()}",
            organization_id=organization_id,
            local_session_id=record.local_session_id,
            export_id=record.id,
            assist_receipt_id=None,
            event_type="export_sent",
            recorded_at=sent_at,
            actor_id=actor_id,
            provider=None,
            model_name=None,
            policy_mode=None,
            latency_ms=None,
            error_code=None,
            reviewer_action=None,
            assessment_payload=None,
        )
    )

    await db.commit()
    refreshed = await get_approved_export(db, organization_id, export_id)
    if refreshed is None:
        raise RuntimeError("approved export could not be reloaded after release")
    return refreshed


async def list_ops_events(
    db: AsyncSession,
    organization_id: str,
    local_session_id: str | None = None,
    event_type: str | None = None,
) -> list[OpsEventModel]:
    query = (
        select(OpsEventRecord)
        .where(OpsEventRecord.organization_id == organization_id)
        .order_by(OpsEventRecord.recorded_at.desc())
    )

    if local_session_id:
        query = query.where(OpsEventRecord.local_session_id == local_session_id)
    if event_type:
        query = query.where(OpsEventRecord.event_type == event_type)

    result = await db.execute(query)
    return [_ops_event_model(record) for record in result.scalars().all()]


async def ingest_ops_event(
    db: AsyncSession,
    organization_id: str,
    payload: OpsEventModel,
) -> OpsEventModel:
    if payload.organizationId not in {None, organization_id}:
        raise OpsEventIngestError(
            status_code=400,
            detail="ops event organization does not match authenticated organization",
        )

    result = await db.execute(
        select(OpsEventRecord).where(
            OpsEventRecord.id == payload.id,
            OpsEventRecord.organization_id == organization_id,
        )
    )
    record = result.scalar_one_or_none()

    if record is None:
        record = OpsEventRecord(id=payload.id, organization_id=organization_id)
        db.add(record)

    record.organization_id = organization_id
    record.local_session_id = payload.localSessionId
    record.export_id = payload.exportId
    record.assist_receipt_id = payload.assistReceiptId
    record.event_type = payload.type
    record.recorded_at = _parse_timestamp(payload.recordedAt) or datetime.now(
        timezone.utc
    )
    record.actor_id = payload.actorId
    record.provider = payload.provider
    record.model_name = payload.model
    record.policy_mode = payload.policyMode
    record.latency_ms = payload.latencyMs
    record.error_code = payload.errorCode
    record.reviewer_action = payload.reviewerAction
    record.assessment_payload = (
        payload.assessment.model_dump() if payload.assessment is not None else None
    )

    # Same global-id / org-scoped-lookup mismatch as approved exports: a
    # cross-org id collision must become a 409, not an unhandled 500.
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise OpsEventIngestError(
            status_code=409,
            detail=f"an ops event with id '{payload.id}' already exists",
        ) from exc

    await db.refresh(record)
    return _ops_event_model(record)


async def get_ops_summary(
    db: AsyncSession,
    organization_id: str,
) -> OpsSummaryModel:
    exports = await list_approved_exports(db, organization_id)
    ops_events = await list_ops_events(db, organization_id)

    sent_latencies = [
        (
            (_parse_timestamp(item.export.sentAt) or datetime.now(timezone.utc))
            - (_parse_timestamp(item.export.approvedAt) or datetime.now(timezone.utc))
        ).total_seconds()
        * 1000
        for item in exports
        if item.export.status == "sent" and item.export.sentAt is not None
    ]

    return OpsSummaryModel(
        totalExports=len(exports),
        approvedExports=sum(1 for item in exports if item.export.status == "approved"),
        sentExports=sum(1 for item in exports if item.export.status == "sent"),
        assistUsageCount=sum(1 for item in ops_events if item.type == "assist_requested"),
        assistOverrideCount=sum(
            1 for item in ops_events if item.type == "assist_overridden"
        ),
        redactionBlockCount=sum(
            1 for item in ops_events if item.type == "redaction_blocked"
        ),
        averageSendLatencyMs=(
            sum(sent_latencies) / len(sent_latencies) if sent_latencies else None
        ),
    )
