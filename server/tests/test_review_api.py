import asyncio

from fastapi.testclient import TestClient

from app.main import app
from app.models.database import Base, engine


def reset_database() -> None:
    async def _reset() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(_reset())


def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={
            "email": "reviewer@demo-health.local",
            "password": "demo-reviewer",
            "role": "reviewer",
            "organization_id": "demo-health",
        },
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def session_bundle_payload() -> dict:
    timestamp = "2026-03-15T10:00:00Z"

    return {
        "session": {
            "id": "session-integration-001",
            "clinicianId": "clinician-42",
            "organizationId": "demo-health",
            "encounterStartedAt": timestamp,
            "encounterEndedAt": "2026-03-15T10:22:00Z",
            "captureMode": "audio_import",
            "transcriptStatus": "completed",
            "reviewStatus": "ready",
            "exportStatus": "not_requested",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "consent": {
                "recordedWithConsent": True,
                "exportAllowed": True,
                "capturedAt": timestamp,
                "capturedBy": "desktop-import",
            },
        },
        "transcriptSegments": [
            {
                "id": "segment-001",
                "sessionId": "session-integration-001",
                "speakerLabel": "patient",
                "text": "I missed two doses because the refill was delayed.",
                "startOffsetMs": 0,
                "endOffsetMs": 4300,
                "transcriptConfidence": 0.97,
                "speakerConfidence": 0.91,
                "source": "audio_import",
            }
        ],
        "findings": [
            {
                "id": "finding-001",
                "sessionId": "session-integration-001",
                "code": "medication-adherence",
                "title": "Medication adherence needs review",
                "summary": "The patient reported missing two doses due to a delayed refill.",
                "status": "pending_review",
                "confidence": 0.82,
                "evidenceSpans": [
                    {
                        "id": "evidence-001",
                        "transcriptSegmentId": "segment-001",
                        "excerpt": "I missed two doses because the refill was delayed.",
                        "startOffsetMs": 0,
                        "endOffsetMs": 4300,
                        "startTextOffset": 0,
                        "endTextOffset": 50,
                    }
                ],
                "detectedBy": "rules",
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
        ],
        "reviewDecisions": [],
        "approvedExports": [],
        "auditLogEntries": [
            {
                "id": "audit-001",
                "sessionId": "session-integration-001",
                "timestamp": timestamp,
                "action": "session_created",
                "actorId": "desktop-import",
                "details": {"captureMode": "audio_import"},
            }
        ],
    }


def approved_export_payload() -> dict:
    return {
        "id": "export-001",
        "sessionId": "session-integration-001",
        "status": "approved",
        "summary": "Approved summary for medication adherence follow-up.",
        "findings": [
            {
                "findingId": "finding-001",
                "code": "medication-adherence",
                "title": "Medication adherence needs review",
                "summary": "The patient missed doses because the refill was delayed.",
                "reviewDecisionId": "decision-placeholder",
                "evidenceExcerpts": [
                    {
                        "sourceEvidenceSpanId": "evidence-001",
                        "sourceTranscriptSegmentId": "segment-001",
                        "excerpt": "I missed two doses because the refill was delayed.",
                        "startOffsetMs": 0,
                        "endOffsetMs": 4300,
                    }
                ],
            }
        ],
        "approvedBy": "quality-lead-1",
        "approvedAt": "2026-03-15T10:30:00Z",
        "destination": "qa-review-queue",
    }


def test_review_workflow_round_trip() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        create_session = client.post(
            "/api/sessions/",
            json=session_bundle_payload(),
            headers=headers,
        )
        assert create_session.status_code == 201, create_session.text
        created_bundle = create_session.json()
        assert created_bundle["session"]["id"] == "session-integration-001"
        assert len(created_bundle["findings"]) == 1

        listed_sessions = client.get("/api/sessions/", headers=headers)
        assert listed_sessions.status_code == 200, listed_sessions.text
        assert listed_sessions.json()[0]["clinicianId"] == "clinician-42"

        listed_findings = client.get(
            "/api/findings/?status=pending_review",
            headers=headers,
        )
        assert listed_findings.status_code == 200, listed_findings.text
        assert listed_findings.json()[0]["id"] == "finding-001"

        review_decision = client.post(
            "/api/findings/finding-001/review-decisions",
            json={
                "outcome": "accepted",
                "reviewedBy": "reviewer-1",
                "rationale": "Evidence is direct and should move forward to export.",
            },
            headers=headers,
        )
        assert review_decision.status_code == 201, review_decision.text
        decision_id = review_decision.json()["id"]

        accepted_finding = client.get("/api/findings/finding-001", headers=headers)
        assert accepted_finding.status_code == 200, accepted_finding.text
        assert accepted_finding.json()["status"] == "accepted"
        assert accepted_finding.json()["reviewDecisionId"] == decision_id

        export_payload = approved_export_payload()
        export_payload["findings"][0]["reviewDecisionId"] = decision_id
        approved_export = client.post(
            "/api/approved-exports/",
            json=export_payload,
            headers=headers,
        )
        assert approved_export.status_code == 201, approved_export.text
        assert approved_export.json()["status"] == "approved"

        listed_exports = client.get(
            "/api/approved-exports/?export_status=approved",
            headers=headers,
        )
        assert listed_exports.status_code == 200, listed_exports.text
        assert listed_exports.json()[0]["id"] == "export-001"

        session_bundle = client.get(
            "/api/sessions/session-integration-001",
            headers=headers,
        )
        assert session_bundle.status_code == 200, session_bundle.text
        assert session_bundle.json()["session"]["reviewStatus"] == "completed"
        assert session_bundle.json()["session"]["exportStatus"] == "approved"
