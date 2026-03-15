import asyncio
import os
from pathlib import Path

from fastapi.testclient import TestClient

TEST_DATABASE_PATH = Path(__file__).with_suffix(".sqlite3").resolve()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DATABASE_PATH}"

from app.api.review_models import SessionBundleModel
from app.main import app
from app.models.database import Base, async_session, engine
from app.services.review_repository import upsert_session_bundle


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


def review_session_payload() -> dict:
    return session_bundle_payload()["session"]


def seed_review_state() -> None:
    async def _seed() -> None:
        bundle_payload = session_bundle_payload()
        bundle_payload["transcriptSegments"] = []

        async with async_session() as db:
            await upsert_session_bundle(
                db=db,
                organization_id="demo-health",
                payload=SessionBundleModel.model_validate(bundle_payload),
            )

    asyncio.run(_seed())


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


def create_review_decision(
    client: TestClient,
    headers: dict[str, str],
    outcome: str = "accepted",
) -> str:
    review_decision = client.post(
        "/api/findings/finding-001/review-decisions",
        json={
            "outcome": outcome,
            "reviewedBy": "reviewer-1",
            "rationale": "Evidence is direct and should move forward to export.",
        },
        headers=headers,
    )
    assert review_decision.status_code == 201, review_decision.text
    return review_decision.json()["id"]


def test_review_workflow_round_trip() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        create_session = client.post(
            "/api/sessions/",
            json=review_session_payload(),
            headers=headers,
        )
        assert create_session.status_code == 201, create_session.text
        created_session = create_session.json()
        assert created_session["id"] == "session-integration-001"

        seed_review_state()

        listed_sessions = client.get("/api/sessions/", headers=headers)
        assert listed_sessions.status_code == 200, listed_sessions.text
        assert listed_sessions.json()[0]["clinicianId"] == "clinician-42"

        listed_findings = client.get(
            "/api/findings/?status=pending_review",
            headers=headers,
        )
        assert listed_findings.status_code == 200, listed_findings.text
        assert listed_findings.json()[0]["id"] == "finding-001"

        decision_id = create_review_decision(client, headers)

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

        session_record = client.get(
            "/api/sessions/session-integration-001",
            headers=headers,
        )
        assert session_record.status_code == 200, session_record.text
        assert session_record.json()["reviewStatus"] == "completed"
        assert session_record.json()["exportStatus"] == "approved"
        assert "transcriptSegments" not in session_record.json()
        assert "findings" not in session_record.json()


def test_sessions_endpoint_rejects_full_bundle_payload() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        response = client.post(
            "/api/sessions/",
            json=session_bundle_payload(),
            headers=headers,
        )

        assert response.status_code == 422, response.text


def test_session_detail_returns_metadata_only() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        create_session = client.post(
            "/api/sessions/",
            json=review_session_payload(),
            headers=headers,
        )
        assert create_session.status_code == 201, create_session.text

        seed_review_state()

        response = client.get(
            "/api/sessions/session-integration-001",
            headers=headers,
        )

        assert response.status_code == 200, response.text
        assert response.json()["id"] == "session-integration-001"
        assert "transcriptSegments" not in response.json()
        assert "findings" not in response.json()
        assert "reviewDecisions" not in response.json()
        assert "approvedExports" not in response.json()
        assert "auditLogEntries" not in response.json()


def test_approved_export_rejects_raw_transcript_fields() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        create_session = client.post(
            "/api/sessions/",
            json=review_session_payload(),
            headers=headers,
        )
        assert create_session.status_code == 201, create_session.text

        seed_review_state()

        decision_id = create_review_decision(client, headers)
        export_payload = approved_export_payload()
        export_payload["findings"][0]["reviewDecisionId"] = decision_id
        export_payload["transcriptSegments"] = session_bundle_payload()[
            "transcriptSegments"
        ]

        response = client.post(
            "/api/approved-exports/",
            json=export_payload,
            headers=headers,
        )

        assert response.status_code == 422, response.text
        assert any(
            error["loc"] == ["body", "transcriptSegments"]
            for error in response.json()["detail"]
        )


def test_approved_export_rejects_audio_upload_fields() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        create_session = client.post(
            "/api/sessions/",
            json=review_session_payload(),
            headers=headers,
        )
        assert create_session.status_code == 201, create_session.text

        seed_review_state()

        decision_id = create_review_decision(client, headers)
        export_payload = approved_export_payload()
        export_payload["findings"][0]["reviewDecisionId"] = decision_id
        export_payload["audioBase64"] = "ZmFrZS1hdWRpby1ieXRlcw=="

        response = client.post(
            "/api/approved-exports/",
            json=export_payload,
            headers=headers,
        )

        assert response.status_code == 422, response.text
        assert any(
            error["loc"] == ["body", "audioBase64"]
            for error in response.json()["detail"]
        )


def test_approved_export_requires_accepted_or_edited_review_decision() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        create_session = client.post(
            "/api/sessions/",
            json=review_session_payload(),
            headers=headers,
        )
        assert create_session.status_code == 201, create_session.text

        seed_review_state()

        decision_id = create_review_decision(client, headers, outcome="uncertain")
        export_payload = approved_export_payload()
        export_payload["findings"][0]["reviewDecisionId"] = decision_id

        response = client.post(
            "/api/approved-exports/",
            json=export_payload,
            headers=headers,
        )

        assert response.status_code == 400, response.text
        assert (
            response.json()["detail"]
            == "approved export findings must reference accepted or edited review decisions"
        )
