from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.review_models import SessionBundleModel
from app.models.schemas import ApprovedExportRecord, FindingRecord, ReviewSessionRecord
from app.services.review_repository import upsert_session_bundle


DEMO_ORGANIZATION_ID = "demo-health"


class DemoSeedError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class DemoSeedSummary:
    seeded: bool
    sessions: int
    findings: int
    approved_exports: int


def _demo_session_bundles() -> list[SessionBundleModel]:
    return [
        SessionBundleModel.model_validate(
            {
                "session": {
                    "id": "session-demo-001",
                    "clinicianId": "clinician-ada",
                    "organizationId": DEMO_ORGANIZATION_ID,
                    "encounterStartedAt": "2026-03-10T15:00:00Z",
                    "encounterEndedAt": "2026-03-10T15:28:00Z",
                    "captureMode": "audio_import",
                    "transcriptStatus": "completed",
                    "reviewStatus": "in_review",
                    "exportStatus": "draft",
                    "createdAt": "2026-03-10T15:35:00Z",
                    "updatedAt": "2026-03-12T09:15:00Z",
                    "consent": {
                        "recordedWithConsent": True,
                        "exportAllowed": True,
                        "capturedAt": "2026-03-10T15:00:00Z",
                        "capturedBy": "desktop-import",
                    },
                },
                "transcriptSegments": [
                    {
                        "id": "segment-demo-001",
                        "sessionId": "session-demo-001",
                        "speakerLabel": "clinician",
                        "text": "I'd like to see you again next week if the refill comes through.",
                        "startOffsetMs": 18000,
                        "endOffsetMs": 23100,
                        "transcriptConfidence": 0.97,
                        "speakerConfidence": 0.94,
                        "source": "audio_import",
                    },
                    {
                        "id": "segment-demo-002",
                        "sessionId": "session-demo-001",
                        "speakerLabel": "clinician",
                        "text": "It may make you dizzy for the first few days.",
                        "startOffsetMs": 9200,
                        "endOffsetMs": 12600,
                        "transcriptConfidence": 0.95,
                        "speakerConfidence": 0.9,
                        "source": "audio_import",
                    },
                ],
                "findings": [
                    {
                        "id": "finding-demo-001",
                        "sessionId": "session-demo-001",
                        "code": "follow-up-plan",
                        "title": "Follow-up plan still needs reviewer confirmation",
                        "summary": "The patient left with a follow-up mention, but the timing language is still ambiguous in the export packet.",
                        "status": "pending_review",
                        "confidence": 0.82,
                        "evidenceSpans": [
                            {
                                "id": "evidence-demo-001",
                                "transcriptSegmentId": "segment-demo-001",
                                "excerpt": "I'd like to see you again next week if the refill comes through.",
                                "startOffsetMs": 18000,
                                "endOffsetMs": 23100,
                            }
                        ],
                        "detectedBy": "rules",
                        "createdAt": "2026-03-10T15:40:00Z",
                        "updatedAt": "2026-03-12T09:15:00Z",
                    },
                    {
                        "id": "finding-demo-002",
                        "sessionId": "session-demo-001",
                        "code": "medication-risk",
                        "title": "Medication side-effect counseling needs evidence trim",
                        "summary": "Evidence spans overlap two adjacent segments and need reviewer cleanup before approval.",
                        "status": "uncertain",
                        "confidence": 0.71,
                        "evidenceSpans": [
                            {
                                "id": "evidence-demo-002",
                                "transcriptSegmentId": "segment-demo-002",
                                "excerpt": "It may make you dizzy for the first few days.",
                                "startOffsetMs": 9200,
                                "endOffsetMs": 12600,
                            }
                        ],
                        "detectedBy": "local_llm",
                        "createdAt": "2026-03-10T15:42:00Z",
                        "updatedAt": "2026-03-12T09:20:00Z",
                    },
                ],
                "reviewDecisions": [],
                "approvedExports": [
                    {
                        "id": "export-demo-003",
                        "sessionId": "session-demo-001",
                        "status": "draft",
                        "summary": "Draft export waiting for final confirmation on medication side-effect counseling.",
                        "findings": [],
                        "approvedBy": "quality-lead-3",
                        "approvedAt": "2026-03-12T09:30:00Z",
                        "destination": "internal-quality-review",
                    }
                ],
                "auditLogEntries": [
                    {
                        "id": "audit-demo-001",
                        "sessionId": "session-demo-001",
                        "timestamp": "2026-03-10T15:35:00Z",
                        "action": "session_created",
                        "actorId": "desktop-import",
                        "details": {"captureMode": "audio_import"},
                    }
                ],
            }
        ),
        SessionBundleModel.model_validate(
            {
                "session": {
                    "id": "session-demo-002",
                    "clinicianId": "clinician-ada",
                    "organizationId": DEMO_ORGANIZATION_ID,
                    "encounterStartedAt": "2026-03-08T17:00:00Z",
                    "encounterEndedAt": "2026-03-08T17:22:00Z",
                    "captureMode": "audio_import",
                    "transcriptStatus": "completed",
                    "reviewStatus": "completed",
                    "exportStatus": "sent",
                    "createdAt": "2026-03-08T17:30:00Z",
                    "updatedAt": "2026-03-09T11:55:00Z",
                    "consent": {
                        "recordedWithConsent": True,
                        "exportAllowed": True,
                        "capturedAt": "2026-03-08T17:00:00Z",
                        "capturedBy": "desktop-import",
                    },
                },
                "transcriptSegments": [
                    {
                        "id": "segment-demo-003",
                        "sessionId": "session-demo-002",
                        "speakerLabel": "clinician",
                        "text": "I hear that this has been exhausting for you.",
                        "startOffsetMs": 6000,
                        "endOffsetMs": 9100,
                        "transcriptConfidence": 0.98,
                        "speakerConfidence": 0.96,
                        "source": "audio_import",
                    }
                ],
                "findings": [
                    {
                        "id": "finding-demo-003",
                        "sessionId": "session-demo-002",
                        "code": "empathy-gap",
                        "title": "Patient concern was acknowledged and approved",
                        "summary": "Reviewer accepted this finding for the final export after confirming the evidence clip.",
                        "status": "accepted",
                        "confidence": 0.65,
                        "evidenceSpans": [
                            {
                                "id": "evidence-demo-003",
                                "transcriptSegmentId": "segment-demo-003",
                                "excerpt": "I hear that this has been exhausting for you.",
                                "startOffsetMs": 6000,
                                "endOffsetMs": 9100,
                            }
                        ],
                        "detectedBy": "human",
                        "createdAt": "2026-03-08T17:35:00Z",
                        "updatedAt": "2026-03-09T11:00:00Z",
                        "reviewDecisionId": "decision-demo-001",
                    }
                ],
                "reviewDecisions": [
                    {
                        "id": "decision-demo-001",
                        "sessionId": "session-demo-002",
                        "findingId": "finding-demo-003",
                        "outcome": "accepted",
                        "reviewedBy": "reviewer-1",
                        "reviewedAt": "2026-03-09T11:00:00Z",
                        "rationale": "Evidence is direct and safe for export.",
                        "approvedEvidenceSpans": [
                            {
                                "id": "evidence-demo-003",
                                "transcriptSegmentId": "segment-demo-003",
                                "excerpt": "I hear that this has been exhausting for you.",
                                "startOffsetMs": 6000,
                                "endOffsetMs": 9100,
                            }
                        ],
                    }
                ],
                "approvedExports": [
                    {
                        "id": "export-demo-001",
                        "sessionId": "session-demo-002",
                        "status": "sent",
                        "summary": "Final export covering the reviewed empathy acknowledgement and callback instructions.",
                        "findings": [
                            {
                                "findingId": "finding-demo-003",
                                "code": "empathy-gap",
                                "title": "Patient concern was acknowledged and approved",
                                "summary": "Reviewer accepted this finding for the final export after confirming the evidence clip.",
                                "reviewDecisionId": "decision-demo-001",
                                "evidenceExcerpts": [
                                    {
                                        "sourceEvidenceSpanId": "evidence-demo-003",
                                        "sourceTranscriptSegmentId": "segment-demo-003",
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
                    }
                ],
                "auditLogEntries": [
                    {
                        "id": "audit-demo-002",
                        "sessionId": "session-demo-002",
                        "timestamp": "2026-03-08T17:30:00Z",
                        "action": "session_created",
                        "actorId": "desktop-import",
                        "details": {"captureMode": "audio_import"},
                    },
                    {
                        "id": "audit-demo-003",
                        "sessionId": "session-demo-002",
                        "timestamp": "2026-03-09T11:00:00Z",
                        "action": "finding_reviewed",
                        "actorId": "reviewer-1",
                        "details": {
                            "findingId": "finding-demo-003",
                            "outcome": "accepted",
                        },
                    },
                    {
                        "id": "audit-demo-004",
                        "sessionId": "session-demo-002",
                        "timestamp": "2026-03-09T11:55:00Z",
                        "action": "export_sent",
                        "actorId": "quality-lead-1",
                        "details": {
                            "exportId": "export-demo-001",
                            "status": "sent",
                            "destination": "compliance-archive",
                        },
                    },
                ],
            }
        ),
        SessionBundleModel.model_validate(
            {
                "session": {
                    "id": "session-demo-003",
                    "clinicianId": "clinician-lin",
                    "organizationId": DEMO_ORGANIZATION_ID,
                    "encounterStartedAt": "2026-03-13T19:10:00Z",
                    "encounterEndedAt": "2026-03-13T19:41:00Z",
                    "captureMode": "live_capture",
                    "transcriptStatus": "completed",
                    "reviewStatus": "ready",
                    "exportStatus": "not_requested",
                    "createdAt": "2026-03-13T19:45:00Z",
                    "updatedAt": "2026-03-14T07:40:00Z",
                    "consent": {
                        "recordedWithConsent": True,
                        "exportAllowed": False,
                        "capturedAt": "2026-03-13T19:10:00Z",
                        "capturedBy": "live-capture",
                    },
                },
                "transcriptSegments": [
                    {
                        "id": "segment-demo-004",
                        "sessionId": "session-demo-003",
                        "speakerLabel": "patient",
                        "text": "When should I call back if the swelling keeps going?",
                        "startOffsetMs": 14100,
                        "endOffsetMs": 17600,
                        "transcriptConfidence": 0.96,
                        "speakerConfidence": 0.93,
                        "source": "live_capture",
                    }
                ],
                "findings": [
                    {
                        "id": "finding-demo-004",
                        "sessionId": "session-demo-003",
                        "code": "direct-question",
                        "title": "Direct patient question has not been answered yet",
                        "summary": "The patient asked when swelling should trigger a callback, but the answer is missing from the current evidence set.",
                        "status": "draft",
                        "confidence": 0.8,
                        "evidenceSpans": [
                            {
                                "id": "evidence-demo-004",
                                "transcriptSegmentId": "segment-demo-004",
                                "excerpt": "When should I call back if the swelling keeps going?",
                                "startOffsetMs": 14100,
                                "endOffsetMs": 17600,
                            }
                        ],
                        "detectedBy": "rules",
                        "createdAt": "2026-03-13T19:48:00Z",
                        "updatedAt": "2026-03-14T07:40:00Z",
                    }
                ],
                "reviewDecisions": [],
                "approvedExports": [],
                "auditLogEntries": [
                    {
                        "id": "audit-demo-005",
                        "sessionId": "session-demo-003",
                        "timestamp": "2026-03-13T19:45:00Z",
                        "action": "session_created",
                        "actorId": "live-capture",
                        "details": {"captureMode": "live_capture"},
                    }
                ],
            }
        ),
        SessionBundleModel.model_validate(
            {
                "session": {
                    "id": "session-demo-004",
                    "clinicianId": "clinician-noor",
                    "organizationId": DEMO_ORGANIZATION_ID,
                    "encounterStartedAt": "2026-03-14T13:00:00Z",
                    "encounterEndedAt": "2026-03-14T13:19:00Z",
                    "captureMode": "audio_import",
                    "transcriptStatus": "completed",
                    "reviewStatus": "completed",
                    "exportStatus": "approved",
                    "createdAt": "2026-03-14T13:26:00Z",
                    "updatedAt": "2026-03-15T08:40:00Z",
                    "consent": {
                        "recordedWithConsent": True,
                        "exportAllowed": True,
                        "capturedAt": "2026-03-14T13:00:00Z",
                        "capturedBy": "desktop-import",
                    },
                },
                "transcriptSegments": [
                    {
                        "id": "segment-demo-005",
                        "sessionId": "session-demo-004",
                        "speakerLabel": "clinician",
                        "text": "We'll transfer this plan to your primary team this afternoon.",
                        "startOffsetMs": 8800,
                        "endOffsetMs": 11900,
                        "transcriptConfidence": 0.97,
                        "speakerConfidence": 0.95,
                        "source": "audio_import",
                    }
                ],
                "findings": [
                    {
                        "id": "finding-demo-005",
                        "sessionId": "session-demo-004",
                        "code": "handoff-clarity",
                        "title": "Handoff summary was edited during review",
                        "summary": "Reviewer tightened the summary language before export approval.",
                        "status": "revised",
                        "confidence": 0.77,
                        "evidenceSpans": [
                            {
                                "id": "evidence-demo-005",
                                "transcriptSegmentId": "segment-demo-005",
                                "excerpt": "We'll transfer this plan to your primary team this afternoon.",
                                "startOffsetMs": 8800,
                                "endOffsetMs": 11900,
                            }
                        ],
                        "detectedBy": "local_llm",
                        "createdAt": "2026-03-14T13:29:00Z",
                        "updatedAt": "2026-03-15T08:35:00Z",
                        "reviewDecisionId": "decision-demo-002",
                    }
                ],
                "reviewDecisions": [
                    {
                        "id": "decision-demo-002",
                        "sessionId": "session-demo-004",
                        "findingId": "finding-demo-005",
                        "outcome": "edited",
                        "reviewedBy": "quality-lead-2",
                        "reviewedAt": "2026-03-15T08:35:00Z",
                        "rationale": "Summary needed a tighter handoff description before approval.",
                        "editedTitle": "Handoff summary was edited during review",
                        "editedSummary": "Reviewer tightened the summary language before export approval.",
                        "approvedEvidenceSpans": [
                            {
                                "id": "evidence-demo-005",
                                "transcriptSegmentId": "segment-demo-005",
                                "excerpt": "We'll transfer this plan to your primary team this afternoon.",
                                "startOffsetMs": 8800,
                                "endOffsetMs": 11900,
                            }
                        ],
                    }
                ],
                "approvedExports": [
                    {
                        "id": "export-demo-002",
                        "sessionId": "session-demo-004",
                        "status": "approved",
                        "summary": "Approved export packet for the updated handoff summary and discharge instructions.",
                        "findings": [
                            {
                                "findingId": "finding-demo-005",
                                "code": "handoff-clarity",
                                "title": "Handoff summary was edited during review",
                                "summary": "Reviewer tightened the summary language before export approval.",
                                "reviewDecisionId": "decision-demo-002",
                                "evidenceExcerpts": [
                                    {
                                        "sourceEvidenceSpanId": "evidence-demo-005",
                                        "sourceTranscriptSegmentId": "segment-demo-005",
                                        "excerpt": "We'll transfer this plan to your primary team this afternoon.",
                                        "startOffsetMs": 8800,
                                        "endOffsetMs": 11900,
                                    }
                                ],
                            }
                        ],
                        "approvedBy": "quality-lead-2",
                        "approvedAt": "2026-03-15T08:40:00Z",
                        "destination": "claims-review-queue",
                    }
                ],
                "auditLogEntries": [
                    {
                        "id": "audit-demo-006",
                        "sessionId": "session-demo-004",
                        "timestamp": "2026-03-14T13:26:00Z",
                        "action": "session_created",
                        "actorId": "desktop-import",
                        "details": {"captureMode": "audio_import"},
                    },
                    {
                        "id": "audit-demo-007",
                        "sessionId": "session-demo-004",
                        "timestamp": "2026-03-15T08:35:00Z",
                        "action": "finding_reviewed",
                        "actorId": "quality-lead-2",
                        "details": {
                            "findingId": "finding-demo-005",
                            "outcome": "edited",
                        },
                    },
                    {
                        "id": "audit-demo-008",
                        "sessionId": "session-demo-004",
                        "timestamp": "2026-03-15T08:40:00Z",
                        "action": "export_approved",
                        "actorId": "quality-lead-2",
                        "details": {
                            "exportId": "export-demo-002",
                            "status": "approved",
                            "destination": "claims-review-queue",
                        },
                    },
                ],
            }
        ),
    ]


async def _count_demo_records(
    db: AsyncSession, organization_id: str
) -> tuple[int, int, int]:
    session_count = int(
        (await db.scalar(
            select(func.count())
            .select_from(ReviewSessionRecord)
            .where(ReviewSessionRecord.organization_id == organization_id)
        ))
        or 0
    )
    finding_count = int(
        (await db.scalar(
            select(func.count())
            .select_from(FindingRecord)
            .join(ReviewSessionRecord)
            .where(ReviewSessionRecord.organization_id == organization_id)
        ))
        or 0
    )
    approved_export_count = int(
        (await db.scalar(
            select(func.count())
            .select_from(ApprovedExportRecord)
            .join(ReviewSessionRecord)
            .where(ReviewSessionRecord.organization_id == organization_id)
        ))
        or 0
    )
    return session_count, finding_count, approved_export_count


async def ensure_demo_review_data(
    db: AsyncSession, organization_id: str
) -> DemoSeedSummary:
    if organization_id != DEMO_ORGANIZATION_ID:
        raise DemoSeedError(
            status_code=403,
            detail="demo data can only be synthesized for the demo organization",
        )

    session_count, finding_count, approved_export_count = await _count_demo_records(
        db, organization_id
    )
    if session_count > 0:
        return DemoSeedSummary(
            seeded=False,
            sessions=session_count,
            findings=finding_count,
            approved_exports=approved_export_count,
        )

    for bundle in _demo_session_bundles():
        await upsert_session_bundle(db, organization_id, bundle)

    session_count, finding_count, approved_export_count = await _count_demo_records(
        db, organization_id
    )
    return DemoSeedSummary(
        seeded=True,
        sessions=session_count,
        findings=finding_count,
        approved_exports=approved_export_count,
    )
