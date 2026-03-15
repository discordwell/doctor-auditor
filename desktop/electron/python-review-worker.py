import json
import importlib.util
import os
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any, Dict

PROVIDER_COMMAND_ADAPTER = "command_adapter"
PROVIDER_FASTER_WHISPER = "faster_whisper"
PROVIDER_OPENAI_WHISPER = "openai_whisper"
SUPPORTED_PROVIDERS = {
    PROVIDER_COMMAND_ADAPTER,
    PROVIDER_FASTER_WHISPER,
    PROVIDER_OPENAI_WHISPER,
}


def respond(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def handle_request(request: Dict[str, Any]) -> None:
    request_id = request["requestId"]

    try:
        kind = request["kind"]
        if kind == "model-availability":
            result = is_model_available(request)
        elif kind == "transcribe-file":
            result = transcribe_file(request)
        else:
            raise RuntimeError(f"Unsupported review ML request: {kind}")

        respond(
            {
                "requestId": request_id,
                "ok": True,
                "result": result,
            }
        )
    except Exception as error:
        respond(
            {
                "requestId": request_id,
                "ok": False,
                "error": str(error),
                "stack": traceback.format_exc(),
            }
        )


def transcribe_file(request: Dict[str, Any]) -> Any:
    provider = resolve_provider(request)

    if provider == PROVIDER_COMMAND_ADAPTER:
        return transcribe_with_command_adapter(request)
    if provider == PROVIDER_FASTER_WHISPER:
        return transcribe_with_faster_whisper(request)
    if provider == PROVIDER_OPENAI_WHISPER:
        return transcribe_with_openai_whisper(request)

    raise RuntimeError(f"Unsupported review ML provider: {provider}")


def is_model_available(request: Dict[str, Any]) -> bool:
    try:
        provider = resolve_provider(request, raise_on_missing=False)
    except Exception:
        return False

    if provider is None:
        return False

    if provider == PROVIDER_COMMAND_ADAPTER:
        command = os.environ.get("DOCTOR_AUDITOR_REVIEW_ML_COMMAND")
        return bool(command) and os.path.isfile(request["modelPath"])

    try:
        return resolve_python_model_reference(request) is not None
    except Exception:
        return False


def resolve_provider(
    request: Dict[str, Any], raise_on_missing: bool = True
) -> str | None:
    configured_provider = os.environ.get("DOCTOR_AUDITOR_REVIEW_ML_PROVIDER")
    if configured_provider:
        if configured_provider not in SUPPORTED_PROVIDERS:
            if raise_on_missing:
                raise RuntimeError(
                    "Unsupported DOCTOR_AUDITOR_REVIEW_ML_PROVIDER. "
                    f"Expected one of {sorted(SUPPORTED_PROVIDERS)}."
                )
            return None
        if not provider_is_usable(configured_provider, request):
            if raise_on_missing:
                raise RuntimeError(build_provider_unavailable_message(configured_provider))
            return None
        return configured_provider

    for candidate in (
        PROVIDER_FASTER_WHISPER,
        PROVIDER_OPENAI_WHISPER,
        PROVIDER_COMMAND_ADAPTER,
    ):
        if provider_is_usable(candidate, request):
            return candidate

    if raise_on_missing:
        raise RuntimeError(
            "No Python review ML backend is configured. Install faster-whisper or "
            "openai-whisper, or set DOCTOR_AUDITOR_REVIEW_ML_PROVIDER=command_adapter "
            "with DOCTOR_AUDITOR_REVIEW_ML_COMMAND."
        )

    return None


def provider_is_usable(provider: str, request: Dict[str, Any]) -> bool:
    if provider == PROVIDER_COMMAND_ADAPTER:
        return bool(os.environ.get("DOCTOR_AUDITOR_REVIEW_ML_COMMAND"))

    if provider == PROVIDER_FASTER_WHISPER:
        if not module_available("faster_whisper"):
            return False
        return resolve_python_model_reference(request, raise_on_missing=False) is not None

    if provider == PROVIDER_OPENAI_WHISPER:
        if not module_available("whisper"):
            return False
        return resolve_python_model_reference(request, raise_on_missing=False) is not None

    return False


def build_provider_unavailable_message(provider: str) -> str:
    if provider == PROVIDER_COMMAND_ADAPTER:
        return (
            "DOCTOR_AUDITOR_REVIEW_ML_PROVIDER=command_adapter requires "
            "DOCTOR_AUDITOR_REVIEW_ML_COMMAND to point at an executable adapter."
        )

    if provider == PROVIDER_FASTER_WHISPER:
        return (
            "faster-whisper is not ready. Install the package and set "
            "DOCTOR_AUDITOR_REVIEW_ML_MODEL or configure a request modelRef."
        )

    if provider == PROVIDER_OPENAI_WHISPER:
        return (
            "openai-whisper is not ready. Install the package and set "
            "DOCTOR_AUDITOR_REVIEW_ML_MODEL or configure a request modelRef."
        )

    return f"Review ML provider {provider} is not usable."


def module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def resolve_python_model_reference(
    request: Dict[str, Any], raise_on_missing: bool = True
) -> str | None:
    request_model_ref = request.get("modelRef")
    if isinstance(request_model_ref, str) and request_model_ref.strip():
        return request_model_ref.strip()

    configured_model = os.environ.get("DOCTOR_AUDITOR_REVIEW_ML_MODEL")
    if configured_model:
        return configured_model

    model_path = request["modelPath"]
    if os.path.isdir(model_path):
        return model_path

    if not raise_on_missing:
        return None

    model_file = Path(model_path)
    if model_file.is_file() and model_file.name.startswith("ggml-"):
        inferred_name = infer_model_name_from_ggml(model_file.name)
        if inferred_name:
            return inferred_name

        raise RuntimeError(
            "Python STT backends cannot consume whisper.cpp ggml files directly. "
            "Set DOCTOR_AUDITOR_REVIEW_ML_MODEL or request.modelRef to a local "
            "faster-whisper/openai-whisper model directory or model name."
        )

    raise RuntimeError(
        "No Python STT model is configured. Set DOCTOR_AUDITOR_REVIEW_ML_MODEL or "
        "request.modelRef to a local model directory or model name."
    )


def infer_model_name_from_ggml(file_name: str) -> str | None:
    if not file_name.startswith("ggml-") or not file_name.endswith(".bin"):
        return None

    return file_name[len("ggml-") : -len(".bin")]


def transcribe_with_command_adapter(request: Dict[str, Any]) -> Any:
    command = os.environ.get("DOCTOR_AUDITOR_REVIEW_ML_COMMAND")
    if not command:
        raise RuntimeError(
            "DOCTOR_AUDITOR_REVIEW_ML_COMMAND is required for command_adapter."
        )

    completed = subprocess.run(
        [command],
        input=json.dumps(request).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        env=os.environ.copy(),
    )

    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8").strip()
        if stderr:
            raise RuntimeError(stderr)
        raise RuntimeError(
            f"Review ML command adapter exited with code {completed.returncode}."
        )

    stdout = completed.stdout.decode("utf-8").strip()
    if not stdout:
        return []

    return json.loads(stdout)


def transcribe_with_faster_whisper(request: Dict[str, Any]) -> Any:
    from faster_whisper import WhisperModel

    model_reference = resolve_python_model_reference(request)
    device = os.environ.get("DOCTOR_AUDITOR_REVIEW_ML_DEVICE", "auto")
    compute_type = os.environ.get("DOCTOR_AUDITOR_REVIEW_ML_COMPUTE_TYPE", "default")
    download_root = resolve_download_root(request)

    model = WhisperModel(
        model_reference,
        device=device,
        compute_type=compute_type,
        download_root=download_root,
    )
    segments, _ = model.transcribe(
        request["audioPath"],
        language=request["language"],
        word_timestamps=False,
    )

    return [
        {
            "id": f"segment-{index}",
            "sessionId": request["sessionId"],
            "speakerLabel": "unknown",
            "text": (segment.text or "").strip(),
            "startOffsetMs": int(round(segment.start * 1000)),
            "endOffsetMs": int(round(segment.end * 1000)),
            "transcriptConfidence": 0.8,
            "source": request["source"],
        }
        for index, segment in enumerate(segments, start=1)
        if (segment.text or "").strip()
    ]


def transcribe_with_openai_whisper(request: Dict[str, Any]) -> Any:
    import whisper

    model_reference = resolve_python_model_reference(request)
    download_root = resolve_download_root(request)
    model = whisper.load_model(model_reference, download_root=download_root)
    result = model.transcribe(
        request["audioPath"],
        language=request["language"],
        fp16=False,
    )

    return [
        {
            "id": f"segment-{index}",
            "sessionId": request["sessionId"],
            "speakerLabel": "unknown",
            "text": (segment.get("text") or "").strip(),
            "startOffsetMs": int(round(float(segment.get("start", 0)) * 1000)),
            "endOffsetMs": int(round(float(segment.get("end", 0)) * 1000)),
            "transcriptConfidence": 0.8,
            "source": request["source"],
        }
        for index, segment in enumerate(result.get("segments", []), start=1)
        if (segment.get("text") or "").strip()
    ]


def resolve_download_root(request: Dict[str, Any]) -> str | None:
    configured_root = os.environ.get("DOCTOR_AUDITOR_REVIEW_ML_CACHE_DIR")
    if configured_root:
        return configured_root

    model_path = request.get("modelPath")
    if not isinstance(model_path, str) or not model_path:
        return None

    candidate = Path(model_path)
    if candidate.is_dir():
        return str(candidate)

    if candidate.suffix:
        return str(candidate.parent)

    return None


def main() -> None:
    for line in sys.stdin:
        payload = line.strip()
        if not payload:
            continue

        request = json.loads(payload)
        handle_request(request)


if __name__ == "__main__":
    main()
