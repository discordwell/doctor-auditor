from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.cloud_models import ApprovedExportEnvelopeModel, OpsEventModel
from app.models.schemas import ApprovedExportRecord, OpsEventRecord
from app.services.cloud_repository import ingest_approved_export, ingest_ops_event


DEMO_ORGANIZATION_ID = "demo-health"


class DemoSeedError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class DemoSeedSummary:
    seeded: bool
    approved_exports: int
    ops_events: int


def _demo_export_envelopes() -> list[ApprovedExportEnvelopeModel]:
    return [
        ApprovedExportEnvelopeModel.model_validate(
            {
                "id": "export-demo-001",
                "organizationId": DEMO_ORGANIZATION_ID,
                "session": {
                    "localSessionId": "session-demo-002",
                    "clinicianId": "clinician-ada",
                    "encounterStartedAt": "2026-03-08T17:00:00Z",
                    "encounterEndedAt": "2026-03-08T17:22:00Z",
                    "captureMode": "audio_import",
                },
                "consent": {
                    "recordedWithConsent": True,
                    "exportAllowed": True,
                    "remoteAssistAllowed": True,
                    "policyVersion": "policy-v1",
                },
                "export": {
                    "id": "export-demo-001",
                    "sessionId": "session-demo-002",
                    "status": "sent",
                    "summary": "Final export covering the reviewed empathy acknowledgement.",
                    "findings": [
                        {
                            "findingId": "finding-local-003",
                            "code": "empathy-gap",
                            "title": "Patient concern was acknowledged and approved",
                            "summary": "Reviewer accepted this finding for the final export.",
                            "reviewDecisionId": "decision-local-001",
                            "evidenceExcerpts": [
                                {
                                    "sourceEvidenceSpanId": "evidence-local-003",
                                    "sourceTranscriptSegmentId": "segment-local-003",
                                    "excerpt": "I hear that this has been exhausting for you.",
                                    "startOffsetMs": 6000,
                                    "endOffsetMs": 9100,
                                }
                            ],
                        }
                    ],
                    "approvedBy": "quality-lead-1",
                    "approvedAt": "2026-03-09T11:20:00Z",
                    "destination": "compliance-archive",
                    "sentAt": "2026-03-09T11:55:00Z",
                },
                "attestation": {
                    "reviewedBy": "reviewer-1",
                    "reviewCompletedAt": "2026-03-09T11:00:00Z",
                    "clientVersion": "desktop-demo-1.0.0",
                    "localBundleHash": "bundle-hash-demo-001",
                    "assistReceiptIds": ["assist-demo-001"],
                },
            }
        ),
        ApprovedExportEnvelopeModel.model_validate(
            {
                "id": "export-demo-002",
                "organizationId": DEMO_ORGANIZATION_ID,
                "session": {
                    "localSessionId": "session-demo-004",
                    "clinicianId": "clinician-noor",
                    "encounterStartedAt": "2026-03-14T13:00:00Z",
                    "encounterEndedAt": "2026-03-14T13:19:00Z",
                    "captureMode": "audio_import",
                },
                "consent": {
                    "recordedWithConsent": True,
                    "exportAllowed": True,
                    "remoteAssistAllowed": False,
                    "policyVersion": "policy-v1",
                },
                "export": {
                    "id": "export-demo-002",
                    "sessionId": "session-demo-004",
                    "status": "approved",
                    "summary": "Approved export packet for the updated handoff summary.",
                    "findings": [
                        {
                            "findingId": "finding-local-005",
                            "code": "handoff-clarity",
                            "title": "Handoff summary was edited during review",
                            "summary": "Reviewer tightened the summary language before export approval.",
                            "reviewDecisionId": "decision-local-002",
                            "evidenceExcerpts": [
                                {
                                    "sourceEvidenceSpanId": "evidence-local-005",
                                    "sourceTranscriptSegmentId": "segment-local-005",
                                    "excerpt": "Please call if the dizziness returns before the handoff lands.",
                                    "startOffsetMs": 9000,
                                    "endOffsetMs": 13200,
                                }
                            ],
                        }
                    ],
                    "approvedBy": "quality-lead-2",
                    "approvedAt": "2026-03-15T08:40:00Z",
                    "destination": "claims-review-queue",
                },
                "attestation": {
                    "reviewedBy": "quality-lead-2",
                    "reviewCompletedAt": "2026-03-15T08:35:00Z",
                    "clientVersion": "desktop-demo-1.0.0",
                    "localBundleHash": "bundle-hash-demo-002",
                    "assistReceiptIds": [],
                },
            }
        ),
    ]


def _demo_ops_events() -> list[OpsEventModel]:
    return [
        OpsEventModel.model_validate(
            {
                "id": "ops-demo-001",
                "organizationId": DEMO_ORGANIZATION_ID,
                "localSessionId": "session-demo-002",
                "assistReceiptId": "assist-demo-001",
                "type": "assist_requested",
                "recordedAt": "2026-03-09T10:58:00Z",
                "actorId": "reviewer-1",
                "provider": "doctor-auditor-assist-gateway",
                "model": "policy-heuristic-v1",
                "policyMode": "minimized_no_raw_phi",
            }
        ),
        OpsEventModel.model_validate(
            {
                "id": "ops-demo-002",
                "organizationId": DEMO_ORGANIZATION_ID,
                "localSessionId": "session-demo-002",
                "assistReceiptId": "assist-demo-001",
                "type": "assist_completed",
                "recordedAt": "2026-03-09T10:58:01Z",
                "actorId": "reviewer-1",
                "provider": "doctor-auditor-assist-gateway",
                "model": "policy-heuristic-v1",
                "policyMode": "minimized_no_raw_phi",
                "latencyMs": 812,
            }
        ),
        OpsEventModel.model_validate(
            {
                "id": "ops-demo-003",
                "organizationId": DEMO_ORGANIZATION_ID,
                "localSessionId": "session-demo-002",
                "exportId": "export-demo-001",
                "type": "export_sent",
                "recordedAt": "2026-03-09T11:55:00Z",
                "actorId": "quality-lead-1",
            }
        ),
        OpsEventModel.model_validate(
            {
                "id": "ops-demo-004",
                "organizationId": DEMO_ORGANIZATION_ID,
                "localSessionId": "session-demo-004",
                "type": "redaction_blocked",
                "recordedAt": "2026-03-15T08:10:00Z",
                "actorId": "quality-lead-2",
                "errorCode": "manual-redaction-required",
            }
        ),
        OpsEventModel.model_validate(
            {
                "id": "ops-demo-005",
                "organizationId": DEMO_ORGANIZATION_ID,
                "localSessionId": "session-demo-004",
                "type": "export_approved",
                "exportId": "export-demo-002",
                "recordedAt": "2026-03-15T08:40:00Z",
                "actorId": "quality-lead-2",
            }
        ),
    ]


async def _count_demo_records(
    db: AsyncSession,
) -> tuple[int, int]:
    export_count = await db.scalar(
        select(func.count(ApprovedExportRecord.id)).where(
            ApprovedExportRecord.organization_id == DEMO_ORGANIZATION_ID
        )
    )
    ops_count = await db.scalar(
        select(func.count(OpsEventRecord.id)).where(
            OpsEventRecord.organization_id == DEMO_ORGANIZATION_ID
        )
    )
    return export_count or 0, ops_count or 0


async def ensure_demo_review_data(
    db: AsyncSession,
    organization_id: str,
) -> DemoSeedSummary:
    if organization_id != DEMO_ORGANIZATION_ID:
        raise DemoSeedError(
            status_code=403,
            detail="demo data can only be synthesized for the demo organization",
        )

    export_count, ops_count = await _count_demo_records(db)
    if export_count > 0 or ops_count > 0:
        return DemoSeedSummary(
            seeded=False,
            approved_exports=export_count,
            ops_events=ops_count,
        )

    for envelope in _demo_export_envelopes():
        await ingest_approved_export(db, DEMO_ORGANIZATION_ID, envelope)

    for event in _demo_ops_events():
        await ingest_ops_event(db, DEMO_ORGANIZATION_ID, event)

    export_count, ops_count = await _count_demo_records(db)
    return DemoSeedSummary(
        seeded=True,
        approved_exports=export_count,
        ops_events=ops_count,
    )
