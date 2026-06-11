import json
import time

import httpx
import pytest

from app.api.cloud_models import AssistGatewayRequestModel
from app.services.assist_gateway_service import (
    PROMPTS,
    AssistGatewayRateLimitError,
    OpenAIAssistGatewayConfig,
    OpenAIAssistGatewayService,
    SlidingWindowRateLimiter,
)


def make_config(**overrides) -> OpenAIAssistGatewayConfig:
    values = {
        "api_key": "test-api-key",
        "api_base_url": "https://upstream.test/v1",
        "enabled": True,
        "model": "gpt-5.4-test",
        "prompt_version": "seriousness-triage-v1",
        "timeout_seconds": 5.0,
        "max_retries": 0,
        "retry_backoff_seconds": 0.01,
        "rate_limit_window_seconds": 60,
        "global_requests_per_window": 100,
        "requester_requests_per_window": 100,
        "max_output_tokens": 400,
        "reasoning_effort": "medium",
        "verbosity": "low",
    }
    values.update(overrides)
    return OpenAIAssistGatewayConfig(**values)


def make_payload(requested_by: str) -> AssistGatewayRequestModel:
    return AssistGatewayRequestModel(
        id=f"assist-request-{requested_by}",
        sessionId="session-local-001",
        findingId="finding-local-001",
        requestedBy=requested_by,
        requestedAt="2026-03-15T10:28:30Z",
        policyVersion="policy-v1",
        policyMode="minimized_no_raw_phi",
        concern={
            "findingCode": "medication-risk",
            "findingStatus": "accepted",
            "findingConfidence": 0.82,
            "evidenceSpanCount": 1,
            "speakerLabels": ["clinician", "patient"],
            "captureMode": "audio_import",
            "encounterDurationMs": 1320000,
        },
    )


def stub_openai_transport() -> httpx.MockTransport:
    decision = {
        "disposition": "routine_review",
        "confidence": 0.4,
        "rationale": "The minimized packet supports routine review.",
        "limitations": [],
    }
    body = {
        "id": "resp-001",
        "model": "gpt-5.4-test",
        "status": "completed",
        "output_text": json.dumps(decision),
        "usage": {},
    }
    return httpx.MockTransport(lambda request: httpx.Response(200, json=body))


def make_service(config: OpenAIAssistGatewayConfig) -> OpenAIAssistGatewayService:
    return OpenAIAssistGatewayService(
        config=config,
        prompt=PROMPTS["seriousness-triage-v1"],
        transport=stub_openai_transport(),
    )


@pytest.mark.asyncio
async def test_requester_rate_limit_keys_on_authenticated_identity() -> None:
    service = make_service(make_config(requester_requests_per_window=1))

    await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    # Rotating the caller-supplied requestedBy must not reset the limit when
    # the authenticated identity stays the same.
    with pytest.raises(AssistGatewayRateLimitError):
        await service.assess(make_payload("reviewer-b"), requester_key="demo-health:1")


@pytest.mark.asyncio
async def test_requester_rejection_does_not_consume_global_capacity() -> None:
    service = make_service(
        make_config(requester_requests_per_window=1, global_requests_per_window=2)
    )

    await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    with pytest.raises(AssistGatewayRateLimitError):
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    # The rejected request above must not have burned the second (and last)
    # global slot, or one over-limit identity could starve everyone else.
    await service.assess(make_payload("reviewer-b"), requester_key="demo-health:2")


@pytest.mark.asyncio
async def test_sliding_window_rate_limiter_enforces_capacity() -> None:
    limiter = SlidingWindowRateLimiter(capacity=1, window_seconds=60)

    await limiter.acquire("requester")

    with pytest.raises(AssistGatewayRateLimitError) as exc_info:
        await limiter.acquire("requester")
    assert exc_info.value.retry_after_seconds is not None
    assert exc_info.value.retry_after_seconds <= 60


@pytest.mark.asyncio
async def test_sliding_window_rate_limiter_prunes_stale_buckets() -> None:
    limiter = SlidingWindowRateLimiter(capacity=2, window_seconds=60)

    await limiter.acquire("stale-requester")
    limiter._buckets["stale-requester"] = [time.monotonic() - 120]

    await limiter.acquire("active-requester")

    assert "stale-requester" not in limiter._buckets
    assert "active-requester" in limiter._buckets


@pytest.mark.asyncio
async def test_sliding_window_rate_limiter_zero_capacity_rejects() -> None:
    limiter = SlidingWindowRateLimiter(capacity=0, window_seconds=60)

    with pytest.raises(AssistGatewayRateLimitError):
        await limiter.acquire("anyone")
