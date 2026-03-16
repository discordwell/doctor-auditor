import atexit
import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

TEST_DATABASE_DIR = Path(tempfile.mkdtemp(prefix="doctor-auditor-review-api-"))
TEST_DATABASE_PATH = TEST_DATABASE_DIR / f"{uuid4().hex}.sqlite3"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DATABASE_PATH}"
atexit.register(shutil.rmtree, TEST_DATABASE_DIR, True)

from app.auth.jwt import create_access_token
from app.main import app
from app.models.database import Base, engine


def reset_database() -> None:
    async def _reset() -> None:
        await engine.dispose()
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


def bearer_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def approved_export_envelope_payload() -> dict:
    return {
        "id": "export-integration-001",
        "organizationId": "demo-health",
        "session": {
            "localSessionId": "session-local-001",
            "clinicianId": "clinician-42",
            "encounterStartedAt": "2026-03-15T10:00:00Z",
            "encounterEndedAt": "2026-03-15T10:22:00Z",
            "captureMode": "audio_import",
        },
        "consent": {
            "recordedWithConsent": True,
            "exportAllowed": True,
            "remoteAssistAllowed": True,
            "policyVersion": "policy-v1",
        },
        "export": {
            "id": "export-integration-001",
            "sessionId": "session-local-001",
            "status": "approved",
            "summary": "Approved summary for medication adherence follow-up.",
            "findings": [
                {
                    "findingId": "finding-local-001",
                    "code": "medication-adherence",
                    "title": "Medication adherence needs review",
                    "summary": "The patient missed doses because the refill was delayed.",
                    "reviewDecisionId": "decision-local-001",
                    "evidenceExcerpts": [
                        {
                            "sourceEvidenceSpanId": "evidence-local-001",
                            "sourceTranscriptSegmentId": "segment-local-001",
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
        },
        "attestation": {
            "reviewedBy": "reviewer-1",
            "reviewCompletedAt": "2026-03-15T10:28:00Z",
            "clientVersion": "desktop-1.0.0",
            "localBundleHash": "bundle-hash-001",
            "assistReceiptIds": ["assist-receipt-001"],
        },
    }


def ops_event_payload() -> dict:
    return {
        "id": "ops-event-001",
        "organizationId": "demo-health",
        "localSessionId": "session-local-001",
        "assistReceiptId": "assist-receipt-001",
        "type": "assist_completed",
        "recordedAt": "2026-03-15T10:29:00Z",
        "actorId": "reviewer-1",
        "provider": "doctor-auditor-assist-gateway",
        "model": "policy-heuristic-v1",
        "policyMode": "minimized_no_raw_phi",
        "latencyMs": 812,
        "assessment": {
            "disposition": "expedited_human_review",
            "confidence": 0.79,
            "rationale": (
                "The finding code maps to a higher-acuity review lane and should be "
                "triaged by a human reviewer."
            ),
            "limitations": [
                "Only minimized structured context was provided.",
                "No raw audio, full transcript, or free-text evidence was available.",
            ],
            "provider": "doctor-auditor-assist-gateway",
            "model": "policy-heuristic-v1",
            "assessedAt": "2026-03-15T10:29:00Z",
        },
    }


def assist_gateway_payload() -> dict:
    return {
        "id": "assist-request-001",
        "sessionId": "session-local-001",
        "findingId": "finding-local-001",
        "requestedBy": "reviewer-1",
        "requestedAt": "2026-03-15T10:28:30Z",
        "policyVersion": "policy-v1",
        "policyMode": "minimized_no_raw_phi",
        "concern": {
            "findingCode": "medication-risk",
            "findingStatus": "accepted",
            "findingConfidence": 0.82,
            "evidenceSpanCount": 1,
            "speakerLabels": ["clinician", "patient"],
            "captureMode": "audio_import",
            "encounterDurationMs": 1320000,
        },
    }


def test_export_and_ops_round_trip() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        created_export = client.post(
            "/api/approved-exports/",
            json=approved_export_envelope_payload(),
            headers=headers,
        )
        assert created_export.status_code == 201, created_export.text
        assert created_export.json()["session"]["localSessionId"] == "session-local-001"

        listed_exports = client.get(
            "/api/approved-exports/?export_status=approved",
            headers=headers,
        )
        assert listed_exports.status_code == 200, listed_exports.text
        assert listed_exports.json()[0]["id"] == "export-integration-001"

        created_event = client.post(
            "/api/ops-events/",
            json=ops_event_payload(),
            headers=headers,
        )
        assert created_event.status_code == 200, created_event.text
        assert created_event.json()["type"] == "assist_completed"
        assert (
            created_event.json()["assessment"]["disposition"]
            == "expedited_human_review"
        )

        listed_events = client.get("/api/ops-events/", headers=headers)
        assert listed_events.status_code == 200, listed_events.text
        assert listed_events.json()[0]["id"] == "ops-event-001"

        summary = client.get("/api/ops-events/summary", headers=headers)
        assert summary.status_code == 200, summary.text
        assert summary.json()["totalExports"] == 1
        assert summary.json()["assistUsageCount"] == 0


def test_sessions_and_findings_routes_are_removed() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        sessions = client.get("/api/sessions/", headers=headers)
        findings = client.get("/api/findings/", headers=headers)

        assert sessions.status_code == 404
        assert findings.status_code == 404


def test_approved_export_rejects_raw_transcript_fields() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)
        payload = approved_export_envelope_payload()
        payload["transcriptSegments"] = [
            {
                "id": "segment-001",
                "text": "Raw transcript text should never be accepted here.",
            }
        ]

        response = client.post(
            "/api/approved-exports/",
            json=payload,
            headers=headers,
        )

        assert response.status_code == 422, response.text
        assert any(
            error["loc"] == ["body", "transcriptSegments"]
            for error in response.json()["detail"]
        )


def test_approved_export_rejects_mismatched_export_id() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)
        payload = approved_export_envelope_payload()
        payload["export"]["id"] = "export-other-001"

        response = client.post(
            "/api/approved-exports/",
            json=payload,
            headers=headers,
        )

        assert response.status_code == 422, response.text
        assert any(
            "export id must match envelope id" in error["msg"]
            for error in response.json()["detail"]
        )


def test_approved_export_rejects_audio_upload_fields() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)
        payload = approved_export_envelope_payload()
        payload["audioBase64"] = "ZmFrZS1hdWRpby1ieXRlcw=="

        response = client.post(
            "/api/approved-exports/",
            json=payload,
            headers=headers,
        )

        assert response.status_code == 422, response.text
        assert any(
            error["loc"] == ["body", "audioBase64"]
            for error in response.json()["detail"]
        )


def test_approved_export_requires_export_consent() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)
        payload = approved_export_envelope_payload()
        payload["consent"]["exportAllowed"] = False

        response = client.post(
            "/api/approved-exports/",
            json=payload,
            headers=headers,
        )

        assert response.status_code == 400, response.text
        assert (
            response.json()["detail"]
            == "exportAllowed must be true for approved export ingestion"
        )


def test_demo_seed_creates_export_and_ops_only() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        response = client.post("/api/demo/seed", headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["approvedExports"] == 6
        assert response.json()["opsEvents"] == 21

        exports = client.get("/api/approved-exports/", headers=headers)
        events = client.get("/api/ops-events/", headers=headers)
        summary = client.get("/api/ops-events/summary", headers=headers)

        assert exports.status_code == 200, exports.text
        assert events.status_code == 200, events.text
        assert summary.status_code == 200, summary.text
        assert len(exports.json()) == 6
        assert len(events.json()) == 21
        assert {item["export"]["status"] for item in exports.json()} == {
            "draft",
            "approved",
            "sent",
        }
        assert summary.json() == {
            "totalExports": 6,
            "approvedExports": 2,
            "sentExports": 3,
            "assistUsageCount": 5,
            "assistOverrideCount": 1,
            "redactionBlockCount": 2,
            "averageSendLatencyMs": 1780000.0,
        }


def test_demo_seed_is_idempotent() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)

        first = client.post("/api/demo/seed", headers=headers)
        second = client.post("/api/demo/seed", headers=headers)

        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert first.json()["seeded"] is True
        assert second.json()["seeded"] is False
        assert second.json()["approvedExports"] == first.json()["approvedExports"]
        assert second.json()["opsEvents"] == first.json()["opsEvents"]
        assert second.json()["approvedExports"] == 6
        assert second.json()["opsEvents"] == 21


def test_ops_event_rejects_mismatched_organization() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)
        payload = ops_event_payload()
        payload["organizationId"] = "other-health"

        response = client.post(
            "/api/ops-events/",
            json=payload,
            headers=headers,
        )

        assert response.status_code == 400, response.text
        assert (
            response.json()["detail"]
            == "ops event organization does not match authenticated organization"
        )


def test_ops_event_rejects_export_events_without_export_id() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)
        payload = ops_event_payload()
        payload.pop("assistReceiptId")
        payload["type"] = "export_sent"

        response = client.post(
            "/api/ops-events/",
            json=payload,
            headers=headers,
        )

        assert response.status_code == 422, response.text
        assert any(
            "exportId is required for export events" in error["msg"]
            for error in response.json()["detail"]
        )


def test_approved_export_rejects_mismatched_organization() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)
        payload = approved_export_envelope_payload()
        payload["organizationId"] = "other-health"

        response = client.post(
            "/api/approved-exports/",
            json=payload,
            headers=headers,
        )

        assert response.status_code == 400, response.text
        assert (
            response.json()["detail"]
            == "export organization does not match authenticated organization"
        )


def test_ops_summary_includes_sent_export_latency_and_assist_usage() -> None:
    reset_database()

    with TestClient(app) as client:
        headers = auth_headers(client)
        payload = approved_export_envelope_payload()
        payload["export"]["status"] = "sent"
        payload["export"]["sentAt"] = "2026-03-15T10:40:00Z"

        created_export = client.post(
            "/api/approved-exports/",
            json=payload,
            headers=headers,
        )
        assert created_export.status_code == 201, created_export.text

        requested_event = ops_event_payload()
        requested_event["id"] = "ops-event-requested-001"
        requested_event["type"] = "assist_requested"
        requested_event["latencyMs"] = None
        requested_event.pop("assessment")

        created_event = client.post(
            "/api/ops-events/",
            json=requested_event,
            headers=headers,
        )
        assert created_event.status_code == 200, created_event.text

        summary = client.get("/api/ops-events/summary", headers=headers)
        assert summary.status_code == 200, summary.text
        body = summary.json()
        assert body["totalExports"] == 1
        assert body["sentExports"] == 1
        assert body["assistUsageCount"] == 1
        assert body["averageSendLatencyMs"] == 600000.0


def test_assist_gateway_returns_structured_assessment() -> None:
    reset_database()

    with TestClient(app) as client:
        response = client.post(
            "/api/assist-gateway/seriousness-assessments",
            json=assist_gateway_payload(),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["disposition"] == "expedited_human_review"
        assert body["provider"] == "doctor-auditor-assist-gateway"

def test_assist_gateway_rejects_raw_transcript_fields() -> None:
    reset_database()

    with TestClient(app) as client:
        payload = assist_gateway_payload()
        payload["concern"]["transcriptSegments"] = [
            {
                "id": "segment-001",
                "text": "Raw transcript text should never cross the assist boundary.",
            }
        ]

        response = client.post(
            "/api/assist-gateway/seriousness-assessments",
            json=payload,
        )

        assert response.status_code == 422, response.text
        assert any(
            error["loc"] == ["body", "concern", "transcriptSegments"]
            for error in response.json()["detail"]
        )


def test_assist_gateway_handles_insufficient_context() -> None:
    reset_database()

    with TestClient(app) as client:
        payload = assist_gateway_payload()
        payload["concern"]["evidenceSpanCount"] = 0

        response = client.post(
            "/api/assist-gateway/seriousness-assessments",
            json=payload,
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["disposition"] == "insufficient_context"
        assert body["provider"] == "doctor-auditor-assist-gateway"


def test_protected_routes_reject_tokens_without_organization_claims() -> None:
    reset_database()

    token = create_access_token(
        {
            "sub": "reviewer-1",
            "email": "reviewer@demo-health.local",
            "role": "reviewer",
        }
    )

    with TestClient(app) as client:
        response = client.get(
            "/api/approved-exports/",
            headers=bearer_headers(token),
        )

        assert response.status_code == 401, response.text
        assert response.json()["detail"] == "Invalid token"
