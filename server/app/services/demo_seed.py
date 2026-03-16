from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.cloud_models import ApprovedExportEnvelopeModel, OpsEventModel
from app.models.schemas import ApprovedExportRecord, OpsEventRecord
from app.services.cloud_repository import ingest_approved_export, ingest_ops_event


DEMO_ORGANIZATION_ID = "demo-health"
DEMO_POLICY_VERSION = "demo-policy-2026.03"
DEMO_CLIENT_VERSION = "desktop-demo-2026.3.0"
ASSIST_PROVIDER = "doctor-auditor-assist-gateway"
ASSIST_MODEL = "policy-heuristic-v1"
ASSIST_POLICY_MODE = "minimized_no_raw_phi"
ASSIST_LIMITATIONS = [
    "Only minimized structured context was provided.",
    "No raw audio, full transcript, or free-text evidence was available.",
]


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


def _excerpt(
    evidence_id: str,
    segment_id: str,
    excerpt: str,
    start_offset_ms: int,
    end_offset_ms: int,
) -> dict:
    return {
        "sourceEvidenceSpanId": evidence_id,
        "sourceTranscriptSegmentId": segment_id,
        "excerpt": excerpt,
        "startOffsetMs": start_offset_ms,
        "endOffsetMs": end_offset_ms,
    }


def _finding(
    finding_id: str,
    code: str,
    title: str,
    summary: str,
    review_decision_id: str,
    *evidence_excerpts: dict,
) -> dict:
    return {
        "findingId": finding_id,
        "code": code,
        "title": title,
        "summary": summary,
        "reviewDecisionId": review_decision_id,
        "evidenceExcerpts": list(evidence_excerpts),
    }


def _export_envelope(
    export_id: str,
    local_session_id: str,
    clinician_id: str,
    encounter_started_at: str,
    encounter_ended_at: str,
    capture_mode: str,
    remote_assist_allowed: bool,
    export_status: str,
    export_summary: str,
    approved_by: str,
    approved_at: str,
    findings: list[dict],
    reviewed_by: str,
    review_completed_at: str,
    local_bundle_hash: str,
    assist_receipt_ids: list[str],
    destination: str | None = None,
    sent_at: str | None = None,
) -> ApprovedExportEnvelopeModel:
    return ApprovedExportEnvelopeModel.model_validate(
        {
            "id": export_id,
            "organizationId": DEMO_ORGANIZATION_ID,
            "session": {
                "localSessionId": local_session_id,
                "clinicianId": clinician_id,
                "encounterStartedAt": encounter_started_at,
                "encounterEndedAt": encounter_ended_at,
                "captureMode": capture_mode,
            },
            "consent": {
                "recordedWithConsent": True,
                "exportAllowed": True,
                "remoteAssistAllowed": remote_assist_allowed,
                "policyVersion": DEMO_POLICY_VERSION,
            },
            "export": {
                "id": export_id,
                "sessionId": local_session_id,
                "status": export_status,
                "summary": export_summary,
                "findings": findings,
                "approvedBy": approved_by,
                "approvedAt": approved_at,
                "destination": destination,
                "sentAt": sent_at,
            },
            "attestation": {
                "reviewedBy": reviewed_by,
                "reviewCompletedAt": review_completed_at,
                "clientVersion": DEMO_CLIENT_VERSION,
                "localBundleHash": local_bundle_hash,
                "assistReceiptIds": assist_receipt_ids,
            },
        }
    )


def _ops_event(
    event_id: str,
    local_session_id: str,
    event_type: str,
    recorded_at: str,
    actor_id: str,
    *,
    export_id: str | None = None,
    assist_receipt_id: str | None = None,
    latency_ms: int | None = None,
    error_code: str | None = None,
    reviewer_action: str | None = None,
    assessment: dict | None = None,
) -> OpsEventModel:
    payload = {
        "id": event_id,
        "organizationId": DEMO_ORGANIZATION_ID,
        "localSessionId": local_session_id,
        "exportId": export_id,
        "assistReceiptId": assist_receipt_id,
        "type": event_type,
        "recordedAt": recorded_at,
        "actorId": actor_id,
        "latencyMs": latency_ms,
        "errorCode": error_code,
        "reviewerAction": reviewer_action,
    }
    if assist_receipt_id:
        payload.update(
            {
                "provider": ASSIST_PROVIDER,
                "model": ASSIST_MODEL,
                "policyMode": ASSIST_POLICY_MODE,
            }
        )
    if assessment is not None:
        payload["assessment"] = assessment

    return OpsEventModel.model_validate(payload)


def _assessment(
    disposition: str,
    confidence: float,
    rationale: str,
    assessed_at: str,
) -> dict:
    return {
        "disposition": disposition,
        "confidence": confidence,
        "rationale": rationale,
        "limitations": ASSIST_LIMITATIONS,
        "provider": ASSIST_PROVIDER,
        "model": ASSIST_MODEL,
        "assessedAt": assessed_at,
    }


def _demo_export_envelopes() -> list[ApprovedExportEnvelopeModel]:
    return [
        _export_envelope(
            export_id="export-demo-001",
            local_session_id="session-demo-001",
            clinician_id="ada-moreno",
            encounter_started_at="2026-02-09T16:00:00Z",
            encounter_ended_at="2026-02-09T16:18:00Z",
            capture_mode="audio_import",
            remote_assist_allowed=True,
            export_status="sent",
            export_summary=(
                "Sent medication access export after reviewer confirmed refill-delay "
                "follow-up and return precautions."
            ),
            approved_by="quality-lead-morgan",
            approved_at="2026-02-09T17:10:00Z",
            findings=[
                _finding(
                    "finding-demo-001",
                    "medication-access-gap",
                    "Medication access barrier was confirmed locally",
                    "Reviewer approved the refill-delay note for downstream export.",
                    "decision-demo-001",
                    _excerpt(
                        "evidence-demo-001",
                        "segment-demo-001",
                        "I used it twice a day until I ran out on Tuesday.",
                        3600,
                        7100,
                    ),
                    _excerpt(
                        "evidence-demo-002",
                        "segment-demo-002",
                        "The pharmacy said the refill was delayed, and I got short of breath again.",
                        9300,
                        14300,
                    ),
                ),
                _finding(
                    "finding-demo-002",
                    "return-precautions-check",
                    "Return precautions were finalized before export",
                    "The reviewer accepted the callback plan and escalation wording.",
                    "decision-demo-002",
                    _excerpt(
                        "evidence-demo-003",
                        "segment-demo-003",
                        "Call if the shortness of breath returns before the refill arrives.",
                        14500,
                        18300,
                    ),
                ),
            ],
            reviewed_by="reviewer-maya",
            review_completed_at="2026-02-09T17:02:00Z",
            local_bundle_hash="bundle-hash-demo-001",
            assist_receipt_ids=["assist-demo-001"],
            destination="compliance-archive",
            sent_at="2026-02-09T17:32:00Z",
        ),
        _export_envelope(
            export_id="export-demo-002",
            local_session_id="session-demo-002",
            clinician_id="noor-hassan",
            encounter_started_at="2026-02-17T20:00:00Z",
            encounter_ended_at="2026-02-17T20:24:00Z",
            capture_mode="live_capture",
            remote_assist_allowed=True,
            export_status="sent",
            export_summary=(
                "Sent discharge handoff export after a retry completed the safe "
                "Remote assist check."
            ),
            approved_by="quality-lead-ivy",
            approved_at="2026-02-17T21:02:00Z",
            findings=[
                _finding(
                    "finding-demo-003",
                    "teach-back-confirmed",
                    "Teach-back for callback triggers was approved",
                    "Reviewer accepted the patient-confirmed return precautions.",
                    "decision-demo-003",
                    _excerpt(
                        "evidence-demo-004",
                        "segment-demo-004",
                        "I would call if the dizziness comes back or if I cannot keep fluids down.",
                        4300,
                        8500,
                    ),
                ),
                _finding(
                    "finding-demo-004",
                    "handoff-clarity",
                    "Cardiology handoff language was approved",
                    "The callback timing and medication change were made explicit before release.",
                    "decision-demo-004",
                    _excerpt(
                        "evidence-demo-005",
                        "segment-demo-005",
                        "The cardiology handoff will mention the medication change and the two day callback.",
                        8700,
                        13200,
                    ),
                    _excerpt(
                        "evidence-demo-006",
                        "segment-demo-006",
                        "Please include that I already scheduled the lab draw for Monday morning.",
                        13400,
                        17100,
                    ),
                ),
            ],
            reviewed_by="reviewer-nia",
            review_completed_at="2026-02-17T20:58:00Z",
            local_bundle_hash="bundle-hash-demo-002",
            assist_receipt_ids=["assist-demo-002a", "assist-demo-002b"],
            destination="care-transition-archive",
            sent_at="2026-02-17T21:48:00Z",
        ),
        _export_envelope(
            export_id="export-demo-003",
            local_session_id="session-demo-003",
            clinician_id="lin-reyes",
            encounter_started_at="2026-02-24T15:00:00Z",
            encounter_ended_at="2026-02-24T15:21:00Z",
            capture_mode="audio_import",
            remote_assist_allowed=False,
            export_status="draft",
            export_summary=(
                "Draft export packet waiting on quality review after callback wording "
                "and scheduling instructions were tightened."
            ),
            approved_by="quality-lead-rio",
            approved_at="2026-02-24T16:05:00Z",
            findings=[
                _finding(
                    "finding-demo-005",
                    "followup-scheduling-clarity",
                    "Scheduling callback wording is still under review",
                    "The reviewer staged the finding in a draft packet pending final approval.",
                    "decision-demo-005",
                    _excerpt(
                        "evidence-demo-007",
                        "segment-demo-007",
                        "I was not sure which number to call if it changes.",
                        3400,
                        7900,
                    ),
                )
            ],
            reviewed_by="reviewer-cam",
            review_completed_at="2026-02-24T15:58:00Z",
            local_bundle_hash="bundle-hash-demo-003",
            assist_receipt_ids=[],
            destination="quality-review-hold",
        ),
        _export_envelope(
            export_id="export-demo-004",
            local_session_id="session-demo-004",
            clinician_id="evan-kline",
            encounter_started_at="2026-03-03T18:00:00Z",
            encounter_ended_at="2026-03-03T18:16:00Z",
            capture_mode="audio_import",
            remote_assist_allowed=True,
            export_status="approved",
            export_summary=(
                "Approved anticoagulant follow-up packet awaiting manual release "
                "after a local override."
            ),
            approved_by="quality-lead-cam",
            approved_at="2026-03-04T09:40:00Z",
            findings=[
                _finding(
                    "finding-demo-006",
                    "anticoagulant-teachback",
                    "Teach-back on dose change was approved",
                    "Reviewer accepted the dose-change language for export.",
                    "decision-demo-006",
                    _excerpt(
                        "evidence-demo-008",
                        "segment-demo-008",
                        "Repeat the new blood thinner dose back to me before you leave.",
                        0,
                        3900,
                    ),
                ),
                _finding(
                    "finding-demo-007",
                    "lab-followup-clarity",
                    "Lab follow-up instructions were approved",
                    "The callback timing and next lab draw were made explicit locally.",
                    "decision-demo-007",
                    _excerpt(
                        "evidence-demo-009",
                        "segment-demo-009",
                        "You will have labs on Thursday morning, and we will call the same afternoon.",
                        4200,
                        9100,
                    ),
                ),
            ],
            reviewed_by="reviewer-cam",
            review_completed_at="2026-03-04T09:34:00Z",
            local_bundle_hash="bundle-hash-demo-004",
            assist_receipt_ids=["assist-demo-004"],
            destination="manual-release-queue",
        ),
        _export_envelope(
            export_id="export-demo-005",
            local_session_id="session-demo-005",
            clinician_id="sofia-santos",
            encounter_started_at="2026-03-10T17:00:00Z",
            encounter_ended_at="2026-03-10T17:20:00Z",
            capture_mode="audio_import",
            remote_assist_allowed=False,
            export_status="approved",
            export_summary=(
                "Approved symptom-escalation export pending compliance release "
                "after a privacy block was resolved locally."
            ),
            approved_by="quality-lead-rio",
            approved_at="2026-03-12T12:15:00Z",
            findings=[
                _finding(
                    "finding-demo-008",
                    "symptom-escalation-plan",
                    "Escalation instructions were approved for export",
                    "The reviewer accepted the callback and same-day escalation language.",
                    "decision-demo-008",
                    _excerpt(
                        "evidence-demo-010",
                        "segment-demo-010",
                        "If the swelling gets worse tonight, call the on-call line and do not wait for clinic hours.",
                        3900,
                        8400,
                    ),
                )
            ],
            reviewed_by="reviewer-rio",
            review_completed_at="2026-03-12T12:08:00Z",
            local_bundle_hash="bundle-hash-demo-005",
            assist_receipt_ids=[],
            destination="claims-review-queue",
        ),
        _export_envelope(
            export_id="export-demo-006",
            local_session_id="session-demo-006",
            clinician_id="mira-patel",
            encounter_started_at="2026-03-14T13:00:00Z",
            encounter_ended_at="2026-03-14T13:18:00Z",
            capture_mode="live_capture",
            remote_assist_allowed=True,
            export_status="sent",
            export_summary=(
                "Sent respiratory follow-up export after local review confirmed "
                "teach-back and handoff readiness."
            ),
            approved_by="quality-lead-morgan",
            approved_at="2026-03-15T08:42:00Z",
            findings=[
                _finding(
                    "finding-demo-009",
                    "handoff-clarity",
                    "Respiratory handoff summary was approved",
                    "The reviewer approved the callback timing and medication restart plan.",
                    "decision-demo-009",
                    _excerpt(
                        "evidence-demo-011",
                        "segment-demo-011",
                        "Please send the respiratory note with the refill delay and restart plan.",
                        8600,
                        12600,
                    ),
                ),
                _finding(
                    "finding-demo-010",
                    "inhaler-teachback",
                    "Teach-back on inhaler restart was approved",
                    "The patient repeated back the restart instructions before export.",
                    "decision-demo-010",
                    _excerpt(
                        "evidence-demo-012",
                        "segment-demo-012",
                        "I will restart the inhaler when the refill arrives and call if I get short of breath again.",
                        4300,
                        9300,
                    ),
                ),
            ],
            reviewed_by="reviewer-maya",
            review_completed_at="2026-03-15T08:36:00Z",
            local_bundle_hash="bundle-hash-demo-006",
            assist_receipt_ids=["assist-demo-006"],
            destination="downstream-qc-feed",
            sent_at="2026-03-15T09:03:00Z",
        ),
    ]


def _demo_ops_events() -> list[OpsEventModel]:
    return [
        _ops_event(
            "ops-demo-001",
            "session-demo-001",
            "assist_requested",
            "2026-02-09T17:04:00Z",
            "reviewer-maya",
            assist_receipt_id="assist-demo-001",
        ),
        _ops_event(
            "ops-demo-002",
            "session-demo-001",
            "assist_completed",
            "2026-02-09T17:04:01Z",
            "reviewer-maya",
            assist_receipt_id="assist-demo-001",
            latency_ms=641,
            assessment=_assessment(
                "routine_review",
                0.41,
                "The minimized packet did not indicate a pattern that required expedited human review.",
                "2026-02-09T17:04:01Z",
            ),
        ),
        _ops_event(
            "ops-demo-003",
            "session-demo-001",
            "export_approved",
            "2026-02-09T17:10:00Z",
            "quality-lead-morgan",
            export_id="export-demo-001",
        ),
        _ops_event(
            "ops-demo-004",
            "session-demo-001",
            "export_sent",
            "2026-02-09T17:32:00Z",
            "ops-release",
            export_id="export-demo-001",
        ),
        _ops_event(
            "ops-demo-005",
            "session-demo-002",
            "assist_requested",
            "2026-02-17T20:48:00Z",
            "reviewer-nia",
            assist_receipt_id="assist-demo-002a",
        ),
        _ops_event(
            "ops-demo-006",
            "session-demo-002",
            "assist_failed",
            "2026-02-17T20:48:02Z",
            "reviewer-nia",
            assist_receipt_id="assist-demo-002a",
            latency_ms=1198,
            error_code="gateway-timeout",
        ),
        _ops_event(
            "ops-demo-007",
            "session-demo-002",
            "assist_requested",
            "2026-02-17T20:51:00Z",
            "reviewer-nia",
            assist_receipt_id="assist-demo-002b",
        ),
        _ops_event(
            "ops-demo-008",
            "session-demo-002",
            "assist_completed",
            "2026-02-17T20:51:01Z",
            "reviewer-nia",
            assist_receipt_id="assist-demo-002b",
            latency_ms=955,
            assessment=_assessment(
                "insufficient_context",
                0.18,
                "The minimized packet did not include enough evidence structure to support a stronger seriousness recommendation.",
                "2026-02-17T20:51:01Z",
            ),
        ),
        _ops_event(
            "ops-demo-009",
            "session-demo-002",
            "export_approved",
            "2026-02-17T21:02:00Z",
            "quality-lead-ivy",
            export_id="export-demo-002",
        ),
        _ops_event(
            "ops-demo-010",
            "session-demo-002",
            "export_sent",
            "2026-02-17T21:48:00Z",
            "ops-release",
            export_id="export-demo-002",
        ),
        _ops_event(
            "ops-demo-011",
            "session-demo-003",
            "redaction_blocked",
            "2026-02-24T16:02:00Z",
            "quality-lead-rio",
            error_code="manual-redaction-required",
        ),
        _ops_event(
            "ops-demo-012",
            "session-demo-004",
            "assist_requested",
            "2026-03-04T09:12:00Z",
            "reviewer-cam",
            assist_receipt_id="assist-demo-004",
        ),
        _ops_event(
            "ops-demo-013",
            "session-demo-004",
            "assist_completed",
            "2026-03-04T09:12:01Z",
            "reviewer-cam",
            assist_receipt_id="assist-demo-004",
            latency_ms=702,
            assessment=_assessment(
                "expedited_human_review",
                0.79,
                "The finding code mapped to a higher-acuity review lane and was routed for human triage.",
                "2026-03-04T09:12:01Z",
            ),
        ),
        _ops_event(
            "ops-demo-014",
            "session-demo-004",
            "assist_overridden",
            "2026-03-04T09:18:00Z",
            "quality-lead-cam",
            assist_receipt_id="assist-demo-004",
            reviewer_action="dismissed",
        ),
        _ops_event(
            "ops-demo-015",
            "session-demo-004",
            "export_approved",
            "2026-03-04T09:40:00Z",
            "quality-lead-cam",
            export_id="export-demo-004",
        ),
        _ops_event(
            "ops-demo-016",
            "session-demo-005",
            "redaction_blocked",
            "2026-03-12T12:05:00Z",
            "quality-lead-rio",
            error_code="policy-minimization-review",
        ),
        _ops_event(
            "ops-demo-017",
            "session-demo-005",
            "export_approved",
            "2026-03-12T12:15:00Z",
            "quality-lead-rio",
            export_id="export-demo-005",
        ),
        _ops_event(
            "ops-demo-018",
            "session-demo-006",
            "assist_requested",
            "2026-03-15T08:31:00Z",
            "reviewer-maya",
            assist_receipt_id="assist-demo-006",
        ),
        _ops_event(
            "ops-demo-019",
            "session-demo-006",
            "assist_completed",
            "2026-03-15T08:31:01Z",
            "reviewer-maya",
            assist_receipt_id="assist-demo-006",
            latency_ms=588,
            assessment=_assessment(
                "routine_review",
                0.41,
                "The minimized packet did not indicate a pattern that required expedited human review.",
                "2026-03-15T08:31:01Z",
            ),
        ),
        _ops_event(
            "ops-demo-020",
            "session-demo-006",
            "export_approved",
            "2026-03-15T08:42:00Z",
            "quality-lead-morgan",
            export_id="export-demo-006",
        ),
        _ops_event(
            "ops-demo-021",
            "session-demo-006",
            "export_sent",
            "2026-03-15T09:03:00Z",
            "ops-release",
            export_id="export-demo-006",
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


async def _demo_record_ids(
    db: AsyncSession,
) -> tuple[set[str], set[str]]:
    export_result = await db.execute(
        select(ApprovedExportRecord.id).where(
            ApprovedExportRecord.organization_id == DEMO_ORGANIZATION_ID
        )
    )
    ops_result = await db.execute(
        select(OpsEventRecord.id).where(
            OpsEventRecord.organization_id == DEMO_ORGANIZATION_ID
        )
    )
    return set(export_result.scalars().all()), set(ops_result.scalars().all())


async def ensure_demo_review_data(
    db: AsyncSession,
    organization_id: str,
) -> DemoSeedSummary:
    if organization_id != DEMO_ORGANIZATION_ID:
        raise DemoSeedError(
            status_code=403,
            detail="demo data can only be synthesized for the demo organization",
        )

    export_envelopes = _demo_export_envelopes()
    ops_events = _demo_ops_events()
    expected_export_ids = {envelope.id for envelope in export_envelopes}
    expected_ops_ids = {event.id for event in ops_events}
    existing_export_ids, existing_ops_ids = await _demo_record_ids(db)

    stale_export_ids = existing_export_ids - expected_export_ids
    stale_ops_ids = existing_ops_ids - expected_ops_ids
    missing_export_ids = expected_export_ids - existing_export_ids
    missing_ops_ids = expected_ops_ids - existing_ops_ids

    if stale_export_ids:
        await db.execute(
            delete(ApprovedExportRecord).where(
                ApprovedExportRecord.organization_id == DEMO_ORGANIZATION_ID,
                ApprovedExportRecord.id.in_(stale_export_ids),
            )
        )
    if stale_ops_ids:
        await db.execute(
            delete(OpsEventRecord).where(
                OpsEventRecord.organization_id == DEMO_ORGANIZATION_ID,
                OpsEventRecord.id.in_(stale_ops_ids),
            )
        )
    if stale_export_ids or stale_ops_ids:
        await db.commit()

    for envelope in export_envelopes:
        await ingest_approved_export(db, DEMO_ORGANIZATION_ID, envelope)

    for event in ops_events:
        await ingest_ops_event(db, DEMO_ORGANIZATION_ID, event)

    export_count, ops_count = await _count_demo_records(db)
    return DemoSeedSummary(
        seeded=bool(
            missing_export_ids
            or missing_ops_ids
            or stale_export_ids
            or stale_ops_ids
            or export_count != len(export_envelopes)
            or ops_count != len(ops_events)
        ),
        approved_exports=export_count,
        ops_events=ops_count,
    )
