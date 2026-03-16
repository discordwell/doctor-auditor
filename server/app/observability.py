from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def set_request_id(request_id: str | None) -> None:
    request_id_var.set(request_id)


def get_request_id() -> str | None:
    return request_id_var.get()


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(message)s",
        force=True,
    )


def log_json(logger: logging.Logger, event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        "recordedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "requestId": get_request_id(),
        **fields,
    }
    logger.info(json.dumps(payload, sort_keys=True, default=str))
