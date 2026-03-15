"""Seed-only helpers for hydrating demo/test review bundles on the server.

This module is intentionally separate from the main review repository so the
production service surface does not imply that the API accepts or mirrors a full
desktop review bundle.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.review_models import SessionBundleModel
from app.models.schemas import ReviewSessionRecord
from app.services.review_repository import (
    _apply_review_session_payload,
    _approved_export_record,
    _audit_log_record,
    _finding_record,
    _review_decision_record,
    _session_record_with_related,
    _transcript_segment_record,
)


async def seed_session_bundle(
    db: AsyncSession,
    organization_id: str,
    payload: SessionBundleModel,
) -> None:
    session_payload = payload.session
    record = await _session_record_with_related(db, organization_id, session_payload.id)

    if record is None:
        record = ReviewSessionRecord(id=session_payload.id)
        db.add(record)

    _apply_review_session_payload(record, organization_id, session_payload)

    record.transcript_segments = [
        _transcript_segment_record(item) for item in payload.transcriptSegments
    ]
    record.findings = [_finding_record(item) for item in payload.findings]
    record.review_decisions = [
        _review_decision_record(item) for item in payload.reviewDecisions
    ]
    record.approved_exports = [
        _approved_export_record(item) for item in payload.approvedExports
    ]
    record.audit_log_entries = [
        _audit_log_record(item) for item in payload.auditLogEntries
    ]

    await db.commit()
