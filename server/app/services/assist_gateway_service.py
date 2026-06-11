from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.api.cloud_models import (
    AssistGatewayRequestModel,
    SeriousnessAssessmentModel,
    SeriousnessDisposition,
)
from app.config import settings
from app.observability import log_json

logger = logging.getLogger(__name__)

OPENAI_PROVIDER = "openai"
PROMPT_REGISTRY_VERSION = "2026-03-15"
RESPONSE_SCHEMA_NAME = "doctor_auditor_seriousness_assessment"
RESPONSE_SCHEMA_VERSION = "seriousness-assessment-v1"
ASSIST_GATEWAY_DECISION_SCHEMA = {
    "type": "object",
    "properties": {
        "disposition": {
            "type": "string",
            "enum": [
                "routine_review",
                "expedited_human_review",
                "insufficient_context",
            ],
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
        },
        "rationale": {
            "type": "string",
            "minLength": 1,
        },
        "limitations": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": [
        "disposition",
        "confidence",
        "rationale",
        "limitations",
    ],
    "additionalProperties": False,
}


class AssistGatewayDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    disposition: SeriousnessDisposition
    confidence: float = Field(ge=0, le=1)
    rationale: str = Field(min_length=1)
    limitations: list[str] = Field(default_factory=list)


class AssistGatewayPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    system_prompt: str


PROMPTS: dict[str, AssistGatewayPrompt] = {
    "seriousness-triage-v1": AssistGatewayPrompt(
        version="seriousness-triage-v1",
        system_prompt=(
            "You are Doctor Auditor's remote assist gateway. "
            "You only receive minimized structured packets; raw audio, raw text, "
            "PHI, and transcript excerpts are unavailable by design. "
            "Assess whether the finding should stay in routine review, be escalated "
            "to expedited human review, or be marked insufficient context. "
            "Use only the packet provided. Never invent evidence or hidden context. "
            "Keep the rationale to one short sentence grounded in the structured "
            "fields, and keep limitations to at most two short items. "
            "If evidenceSpanCount is zero or the packet is too weak, prefer "
            "insufficient_context. Return JSON that matches the schema exactly."
        ),
    )
}


@dataclass(frozen=True)
class OpenAIAssistGatewayConfig:
    api_key: str | None
    api_base_url: str
    enabled: bool
    model: str
    prompt_version: str
    timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float
    rate_limit_window_seconds: int
    global_requests_per_window: int
    requester_requests_per_window: int
    max_output_tokens: int
    reasoning_effort: str
    verbosity: str


class AssistGatewayError(Exception):
    """Base exception for assist gateway failures."""


class AssistGatewayUnavailableError(AssistGatewayError):
    """Raised when the assist provider is unavailable or misconfigured."""


class AssistGatewayValidationError(AssistGatewayError):
    """Raised when the upstream response does not match the required schema."""


class AssistGatewayRateLimitError(AssistGatewayError):
    def __init__(
        self,
        message: str,
        retry_after_seconds: float | None = None,
        *,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds
        self.retryable = retryable


class AssistGatewayUpstreamError(AssistGatewayError):
    def __init__(
        self,
        message: str,
        status_code: int = 502,
        *,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


class AssistGatewayService(Protocol):
    async def assess(
        self,
        payload: AssistGatewayRequestModel,
        *,
        requester_key: str,
    ) -> SeriousnessAssessmentModel: ...


class SlidingWindowRateLimiter:
    def __init__(self, capacity: int, window_seconds: int):
        self.capacity = max(0, capacity)
        self.window_seconds = max(1, window_seconds)
        self._lock = asyncio.Lock()
        self._buckets: dict[str, list[float]] = {}

    async def acquire(self, bucket: str) -> None:
        if self.capacity == 0:
            raise AssistGatewayRateLimitError(
                "Remote assist is rate limited to zero requests until the server "
                "configuration is updated.",
                retry_after_seconds=float(self.window_seconds),
            )

        now = time.monotonic()
        cutoff = now - self.window_seconds

        async with self._lock:
            self._prune_stale_buckets(cutoff)
            timestamps = self._buckets.setdefault(bucket, [])
            while timestamps and timestamps[0] <= cutoff:
                timestamps.pop(0)

            if len(timestamps) >= self.capacity:
                retry_after = max(0.0, self.window_seconds - (now - timestamps[0]))
                raise AssistGatewayRateLimitError(
                    "Remote assist rate limit exceeded. Retry later.",
                    retry_after_seconds=retry_after,
                )

            timestamps.append(now)

    def _prune_stale_buckets(self, cutoff: float) -> None:
        # Buckets are otherwise only trimmed when their own key is touched
        # again, so idle keys would accumulate forever.
        stale_keys = [
            key
            for key, timestamps in self._buckets.items()
            if not timestamps or timestamps[-1] <= cutoff
        ]
        for key in stale_keys:
            del self._buckets[key]


class UnavailableAssistGatewayService:
    def __init__(self, message: str):
        self._message = message

    async def assess(
        self,
        payload: AssistGatewayRequestModel,
        *,
        requester_key: str,
    ) -> SeriousnessAssessmentModel:
        raise AssistGatewayUnavailableError(self._message)


class OpenAIAssistGatewayService:
    def __init__(
        self,
        config: OpenAIAssistGatewayConfig,
        prompt: AssistGatewayPrompt,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep_func: Any = asyncio.sleep,
    ):
        self._config = config
        self._prompt = prompt
        self._transport = transport
        self._sleep = sleep_func
        self._global_rate_limiter = SlidingWindowRateLimiter(
            config.global_requests_per_window,
            config.rate_limit_window_seconds,
        )
        self._requester_rate_limiter = SlidingWindowRateLimiter(
            config.requester_requests_per_window,
            config.rate_limit_window_seconds,
        )

    async def assess(
        self,
        payload: AssistGatewayRequestModel,
        *,
        requester_key: str,
    ) -> SeriousnessAssessmentModel:
        if not self._config.enabled:
            raise AssistGatewayUnavailableError(
                "Remote assist is disabled on this server."
            )
        if not self._config.api_key:
            raise AssistGatewayUnavailableError(
                "Remote assist is unavailable because OPENAI_API_KEY is not configured."
            )

        # Check the requester's own budget first so an over-limit identity
        # burns no shared global capacity with rejected attempts.
        await self._requester_rate_limiter.acquire(requester_key)
        await self._global_rate_limiter.acquire("global")

        audit_context = self._build_audit_context(payload)
        audit_context["authenticatedRequester"] = requester_key
        request_body = self._build_openai_request_body(payload)
        started_at = time.perf_counter()

        self._audit(
            "assist_gateway.request_started",
            **audit_context,
            model=self._config.model,
            promptVersion=self._prompt.version,
            promptRegistryVersion=PROMPT_REGISTRY_VERSION,
            responseSchemaVersion=RESPONSE_SCHEMA_VERSION,
        )

        response_json = await self._request_openai_with_retries(
            audit_context=audit_context,
            request_body=request_body,
        )
        raw_output = self._extract_output_text(response_json)

        try:
            decision = AssistGatewayDecision.model_validate_json(raw_output)
        except ValidationError as exc:
            self._audit(
                "assist_gateway.response_invalid",
                **audit_context,
                error=str(exc),
                responseId=response_json.get("id"),
            )
            raise AssistGatewayValidationError(
                "Remote assist provider returned an invalid structured response."
            ) from exc

        completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        latency_ms = round((time.perf_counter() - started_at) * 1000)
        usage = response_json.get("usage") or {}

        self._audit(
            "assist_gateway.request_completed",
            **audit_context,
            disposition=decision.disposition,
            confidence=decision.confidence,
            latencyMs=latency_ms,
            responseId=response_json.get("id"),
            model=response_json.get("model", self._config.model),
            usage=usage,
        )

        return SeriousnessAssessmentModel(
            disposition=decision.disposition,
            confidence=decision.confidence,
            rationale=decision.rationale,
            limitations=decision.limitations,
            provider=OPENAI_PROVIDER,
            model=response_json.get("model", self._config.model),
            assessedAt=completed_at,
        )

    async def _request_openai_with_retries(
        self,
        *,
        audit_context: dict[str, Any],
        request_body: dict[str, Any],
    ) -> dict[str, Any]:
        attempts = self._config.max_retries + 1

        for attempt in range(1, attempts + 1):
            try:
                return await self._post_openai_response(
                    audit_context=audit_context,
                    request_body=request_body,
                    attempt=attempt,
                )
            except AssistGatewayRateLimitError as exc:
                if attempt >= attempts or not exc.retryable:
                    raise
                retry_delay = (
                    exc.retry_after_seconds
                    if exc.retry_after_seconds is not None
                    else self._retry_delay_seconds(attempt)
                )
                await self._sleep(retry_delay)
            except AssistGatewayUpstreamError as exc:
                if attempt >= attempts or not exc.retryable:
                    raise
                await self._sleep(self._retry_delay_seconds(attempt))
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
                self._audit(
                    "assist_gateway.retryable_network_error",
                    **audit_context,
                    attempt=attempt,
                    error=str(exc),
                )
                if attempt >= attempts:
                    raise AssistGatewayUpstreamError(
                        "Remote assist provider timed out.",
                        status_code=504,
                        retryable=False,
                    ) from exc
                await self._sleep(self._retry_delay_seconds(attempt))

        raise AssistGatewayUpstreamError(
            "Remote assist provider request did not complete."
        )

    async def _post_openai_response(
        self,
        *,
        audit_context: dict[str, Any],
        request_body: dict[str, Any],
        attempt: int,
    ) -> dict[str, Any]:
        timeout = httpx.Timeout(self._config.timeout_seconds)
        url = f"{self._config.api_base_url.rstrip('/')}/responses"

        async with httpx.AsyncClient(
            timeout=timeout,
            transport=self._transport,
        ) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {self._config.api_key}",
                    "Content-Type": "application/json",
                },
                json=request_body,
            )

        if response.status_code == 429:
            retry_after = self._retry_after_seconds(response)
            self._audit(
                "assist_gateway.upstream_rate_limited",
                **audit_context,
                attempt=attempt,
                retryAfterSeconds=retry_after,
            )
            raise AssistGatewayRateLimitError(
                "OpenAI rate limited the remote assist request.",
                retry_after_seconds=retry_after,
                retryable=True,
            )

        if response.status_code >= 400:
            error_message = self._extract_error_message(response)
            retryable = response.status_code in {408, 409, 500, 502, 503, 504}
            status_code = 504 if response.status_code == 408 else 502
            self._audit(
                "assist_gateway.upstream_error",
                **audit_context,
                attempt=attempt,
                upstreamStatus=response.status_code,
                error=error_message,
            )
            raise AssistGatewayUpstreamError(
                error_message,
                status_code=status_code,
                retryable=retryable,
            )

        body = response.json()
        self._audit(
            "assist_gateway.upstream_response",
            **audit_context,
            attempt=attempt,
            responseId=body.get("id"),
            status=body.get("status"),
        )
        return body

    def _build_openai_request_body(
        self, payload: AssistGatewayRequestModel
    ) -> dict[str, Any]:
        return {
            "model": self._config.model,
            "store": False,
            "reasoning": {"effort": self._config.reasoning_effort},
            "text": {
                "verbosity": self._config.verbosity,
                "format": {
                    "type": "json_schema",
                    "name": RESPONSE_SCHEMA_NAME,
                    "schema": ASSIST_GATEWAY_DECISION_SCHEMA,
                    "strict": True,
                },
            },
            "metadata": {
                "assist_request_id": payload.id,
                "assist_policy_version": payload.policyVersion,
                "assist_prompt_version": self._prompt.version,
                "assist_prompt_registry_version": PROMPT_REGISTRY_VERSION,
                "assist_response_schema_version": RESPONSE_SCHEMA_VERSION,
            },
            "input": [
                {
                    "role": "system",
                    "content": self._prompt.system_prompt,
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "request": {
                                "id": payload.id,
                                "sessionId": payload.sessionId,
                                "findingId": payload.findingId,
                                "requestedBy": payload.requestedBy,
                                "requestedAt": payload.requestedAt,
                                "policyVersion": payload.policyVersion,
                                "policyMode": payload.policyMode,
                            },
                            "concern": payload.concern.model_dump(mode="json"),
                        },
                        sort_keys=True,
                    ),
                },
            ],
            "max_output_tokens": self._config.max_output_tokens,
        }

    def _build_audit_context(
        self, payload: AssistGatewayRequestModel
    ) -> dict[str, Any]:
        concern_json = json.dumps(
            payload.concern.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
        )
        packet_hash = hashlib.sha256(concern_json.encode("utf-8")).hexdigest()
        return {
            "assistRequestId": payload.id,
            "sessionId": payload.sessionId,
            "findingId": payload.findingId,
            "requestedBy": payload.requestedBy,
            "policyVersion": payload.policyVersion,
            "policyMode": payload.policyMode,
            "findingCode": payload.concern.findingCode,
            "findingStatus": payload.concern.findingStatus,
            "evidenceSpanCount": payload.concern.evidenceSpanCount,
            "captureMode": payload.concern.captureMode,
            "packetHash": packet_hash,
        }

    def _retry_delay_seconds(self, attempt: int) -> float:
        return self._config.retry_backoff_seconds * (2 ** (attempt - 1))

    def _retry_after_seconds(self, response: httpx.Response) -> float | None:
        header_value = response.headers.get("retry-after")
        if not header_value:
            return None
        try:
            return max(0.0, float(header_value))
        except ValueError:
            return None

    def _extract_output_text(self, response_json: dict[str, Any]) -> str:
        output_text = response_json.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text

        output = response_json.get("output")
        if not isinstance(output, list):
            raise AssistGatewayValidationError(
                "Remote assist provider returned no output payload."
            )

        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") in {"output_text", "text"}:
                    text = block.get("text")
                    if isinstance(text, str) and text.strip():
                        return text

        raise AssistGatewayValidationError(
            "Remote assist provider returned no text output."
        )

    def _extract_error_message(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = None

        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                message = error.get("message")
                if isinstance(message, str) and message.strip():
                    return message

        return f"Remote assist provider returned HTTP {response.status_code}."

    def _audit(self, event: str, **fields: Any) -> None:
        log_json(
            logger,
            event,
            provider=OPENAI_PROVIDER,
            **fields,
        )


@lru_cache(maxsize=1)
def get_assist_gateway_service() -> AssistGatewayService:
    if not settings.assist_gateway_enabled:
        logger.warning(
            "Remote assist is disabled: ASSIST_GATEWAY_ENABLED is false."
        )
        return UnavailableAssistGatewayService(
            "Remote assist is disabled on this server."
        )

    prompt = PROMPTS.get(settings.assist_gateway_prompt_version)
    if prompt is None:
        logger.warning(
            "Remote assist prompt version %s is not registered.",
            settings.assist_gateway_prompt_version,
        )
        return UnavailableAssistGatewayService(
            "Remote assist is unavailable because the configured prompt version is unknown."
        )

    if not settings.openai_api_key:
        logger.warning(
            "Remote assist is unavailable: OPENAI_API_KEY is not configured."
        )
        return UnavailableAssistGatewayService(
            "Remote assist is unavailable because OPENAI_API_KEY is not configured."
        )

    config = OpenAIAssistGatewayConfig(
        api_key=settings.openai_api_key,
        api_base_url=settings.openai_api_base_url,
        enabled=settings.assist_gateway_enabled,
        model=settings.assist_gateway_model,
        prompt_version=settings.assist_gateway_prompt_version,
        timeout_seconds=settings.assist_gateway_timeout_seconds,
        max_retries=settings.assist_gateway_max_retries,
        retry_backoff_seconds=settings.assist_gateway_retry_backoff_seconds,
        rate_limit_window_seconds=settings.assist_gateway_rate_limit_window_seconds,
        global_requests_per_window=settings.assist_gateway_global_requests_per_window,
        requester_requests_per_window=settings.assist_gateway_requester_requests_per_window,
        max_output_tokens=settings.assist_gateway_max_output_tokens,
        reasoning_effort=settings.assist_gateway_reasoning_effort,
        verbosity=settings.assist_gateway_verbosity,
    )
    return OpenAIAssistGatewayService(config=config, prompt=prompt)
