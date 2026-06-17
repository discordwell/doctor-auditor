import json
import time

import httpx
import pytest

from app.api.cloud_models import AssistGatewayRequestModel
from app.services.assist_gateway_service import (
    PROMPTS,
    AssistGatewayRateLimitError,
    AssistGatewayUnavailableError,
    AssistGatewayUpstreamError,
    AssistGatewayValidationError,
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


def success_body(
    disposition: str = "routine_review",
    confidence: float = 0.4,
    rationale: str = "The minimized packet supports routine review.",
    limitations: list[str] | None = None,
) -> dict:
    decision = {
        "disposition": disposition,
        "confidence": confidence,
        "rationale": rationale,
        "limitations": limitations or [],
    }
    return {
        "id": "resp-001",
        "model": "gpt-5.4-test",
        "status": "completed",
        "output_text": json.dumps(decision),
        "usage": {},
    }


def respond(status: int = 200, *, json_body=None, headers=None):
    """A scripted step that returns an HTTP response."""

    def step(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=json_body, headers=headers)

    return step


def raises(exc_factory):
    """A scripted step that raises a transport-level exception."""

    def step(request: httpx.Request) -> httpx.Response:
        raise exc_factory(request)

    return step


class ScriptedTransport:
    """An httpx transport that walks a fixed list of per-call steps.

    Each step is a callable ``(request) -> Response`` that may raise. The
    number of upstream attempts is recorded in ``calls`` so tests can assert
    that retries did (or did not) happen.
    """

    def __init__(self, steps):
        self._steps = list(steps)
        self.calls = 0
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if self.calls >= len(self._steps):
            raise AssertionError(
                "ScriptedTransport received more calls than were scripted"
            )
        step = self._steps[self.calls]
        self.calls += 1
        return step(request)


class RecordingSleeper:
    """A drop-in for asyncio.sleep that records the requested delays."""

    def __init__(self):
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


def make_scripted_service(
    steps,
    sleeper: RecordingSleeper | None = None,
    **config_overrides,
) -> tuple[OpenAIAssistGatewayService, ScriptedTransport, RecordingSleeper]:
    transport = ScriptedTransport(steps)
    sleeper = sleeper or RecordingSleeper()
    service = OpenAIAssistGatewayService(
        config=make_config(**config_overrides),
        prompt=PROMPTS["seriousness-triage-v1"],
        transport=transport.transport,
        sleep_func=sleeper,
    )
    return service, transport, sleeper


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


@pytest.mark.asyncio
async def test_successful_assessment_returns_provider_and_model() -> None:
    service, transport, sleeper = make_scripted_service(
        [respond(json_body=success_body(disposition="routine_review"))]
    )

    assessment = await service.assess(
        make_payload("reviewer-a"), requester_key="demo-health:1"
    )

    assert assessment.disposition == "routine_review"
    assert assessment.provider == "openai"
    assert assessment.model == "gpt-5.4-test"
    assert assessment.assessedAt.endswith("Z")
    assert transport.calls == 1
    assert sleeper.delays == []


@pytest.mark.asyncio
async def test_connect_timeout_is_retried_then_surfaced_as_upstream_error() -> None:
    # Regression test: httpx.ConnectTimeout is a sibling of ConnectError under
    # TimeoutException, so a previous hand-picked except tuple
    # (ConnectError, ReadTimeout, WriteTimeout) let it escape the retry loop and
    # surface as an unhandled 500 after a single attempt.
    service, transport, sleeper = make_scripted_service(
        [
            raises(lambda request: httpx.ConnectTimeout("connect timeout", request=request)),
            raises(lambda request: httpx.ConnectTimeout("connect timeout", request=request)),
        ],
        max_retries=1,
    )

    with pytest.raises(AssistGatewayUpstreamError) as exc_info:
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    assert exc_info.value.status_code == 504
    # initial attempt + one retry, and a single backoff sleep between them
    assert transport.calls == 2
    assert len(sleeper.delays) == 1


@pytest.mark.asyncio
async def test_pool_timeout_is_handled_as_transport_error() -> None:
    # httpx.PoolTimeout is the other TimeoutException sibling that the previous
    # except tuple missed.
    service, transport, _ = make_scripted_service(
        [raises(lambda request: httpx.PoolTimeout("pool timeout", request=request))],
        max_retries=0,
    )

    with pytest.raises(AssistGatewayUpstreamError) as exc_info:
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    assert exc_info.value.status_code == 504
    assert transport.calls == 1


@pytest.mark.asyncio
async def test_connection_error_recovers_after_retry() -> None:
    service, transport, sleeper = make_scripted_service(
        [
            raises(lambda request: httpx.ConnectError("connection refused", request=request)),
            respond(json_body=success_body(disposition="routine_review")),
        ],
        max_retries=1,
    )

    assessment = await service.assess(
        make_payload("reviewer-a"), requester_key="demo-health:1"
    )

    assert assessment.disposition == "routine_review"
    assert transport.calls == 2
    assert len(sleeper.delays) == 1


@pytest.mark.asyncio
async def test_upstream_rate_limit_is_retried_honoring_retry_after() -> None:
    service, transport, sleeper = make_scripted_service(
        [
            respond(
                status=429,
                json_body={"error": {"message": "slow down"}},
                headers={"Retry-After": "2"},
            ),
            respond(json_body=success_body(disposition="routine_review")),
        ],
        max_retries=1,
    )

    assessment = await service.assess(
        make_payload("reviewer-a"), requester_key="demo-health:1"
    )

    assert assessment.disposition == "routine_review"
    assert transport.calls == 2
    # The Retry-After header value is honored verbatim as the backoff delay.
    assert sleeper.delays == [2.0]


@pytest.mark.asyncio
async def test_retryable_upstream_error_is_retried_then_surfaced() -> None:
    service, transport, _ = make_scripted_service(
        [
            respond(status=503, json_body={"error": {"message": "unavailable"}}),
            respond(status=503, json_body={"error": {"message": "unavailable"}}),
        ],
        max_retries=1,
    )

    with pytest.raises(AssistGatewayUpstreamError) as exc_info:
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    assert exc_info.value.status_code == 502
    assert transport.calls == 2


@pytest.mark.asyncio
async def test_non_retryable_upstream_error_surfaces_without_retry() -> None:
    service, transport, sleeper = make_scripted_service(
        [respond(status=400, json_body={"error": {"message": "bad request"}})],
        max_retries=2,
    )

    with pytest.raises(AssistGatewayUpstreamError) as exc_info:
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    assert exc_info.value.status_code == 502
    assert "bad request" in str(exc_info.value)
    # A 4xx (other than 429) is a client-side error and must not be retried.
    assert transport.calls == 1
    assert sleeper.delays == []


@pytest.mark.asyncio
async def test_upstream_408_maps_to_gateway_timeout() -> None:
    service, transport, _ = make_scripted_service(
        [
            respond(status=408, json_body={"error": {"message": "request timeout"}}),
            respond(status=408, json_body={"error": {"message": "request timeout"}}),
        ],
        max_retries=1,
    )

    with pytest.raises(AssistGatewayUpstreamError) as exc_info:
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    assert exc_info.value.status_code == 504
    assert transport.calls == 2


@pytest.mark.asyncio
async def test_invalid_structured_response_raises_validation_error() -> None:
    invalid_decision = {
        "disposition": "not_a_real_disposition",
        "confidence": 2,
        "rationale": "",
        "limitations": [],
    }
    body = {
        "id": "resp-002",
        "model": "gpt-5.4-test",
        "status": "completed",
        "output_text": json.dumps(invalid_decision),
        "usage": {},
    }
    service, transport, _ = make_scripted_service([respond(json_body=body)], max_retries=2)

    with pytest.raises(AssistGatewayValidationError):
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    # A schema mismatch is deterministic, so it must not be retried.
    assert transport.calls == 1


@pytest.mark.asyncio
async def test_missing_output_text_raises_validation_error() -> None:
    body = {"id": "resp-003", "model": "gpt-5.4-test", "status": "completed", "usage": {}}
    service, transport, _ = make_scripted_service([respond(json_body=body)])

    with pytest.raises(AssistGatewayValidationError):
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    assert transport.calls == 1


@pytest.mark.asyncio
async def test_extracts_assessment_from_output_content_blocks() -> None:
    # The Responses API can omit the output_text convenience field and only
    # populate the structured output array (e.g. alongside reasoning items).
    decision = {
        "disposition": "expedited_human_review",
        "confidence": 0.7,
        "rationale": "The minimized packet indicates a higher-acuity concern.",
        "limitations": ["Only minimized structured context was provided."],
    }
    body = {
        "id": "resp-004",
        "model": "gpt-5.4-test",
        "status": "completed",
        "output": [
            {"type": "reasoning", "content": []},
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": json.dumps(decision)}],
            },
        ],
        "usage": {},
    }
    service, transport, _ = make_scripted_service([respond(json_body=body)])

    assessment = await service.assess(
        make_payload("reviewer-a"), requester_key="demo-health:1"
    )

    assert assessment.disposition == "expedited_human_review"
    assert assessment.model == "gpt-5.4-test"
    assert assessment.provider == "openai"
    assert transport.calls == 1


@pytest.mark.asyncio
async def test_disabled_service_raises_unavailable() -> None:
    service, transport, _ = make_scripted_service([], enabled=False)

    with pytest.raises(AssistGatewayUnavailableError):
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    # The guard short-circuits before any upstream call is attempted.
    assert transport.calls == 0


@pytest.mark.asyncio
async def test_missing_api_key_raises_unavailable() -> None:
    service, transport, _ = make_scripted_service([], api_key=None)

    with pytest.raises(AssistGatewayUnavailableError):
        await service.assess(make_payload("reviewer-a"), requester_key="demo-health:1")

    assert transport.calls == 0
