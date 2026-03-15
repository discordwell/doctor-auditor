import json
import importlib.util
import os
import subprocess
import sys
import traceback
from datetime import datetime, timezone
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
        elif kind == "analyze-transcript":
            result = analyze_transcript(request)
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


def analyze_transcript(request: Dict[str, Any]) -> Dict[str, Any]:
    session_id = request["sessionId"]
    session_token = normalize_identifier(session_id)
    transcript_segments = request.get("transcriptSegments") or []
    findings: list[Dict[str, Any]] = []
    evidence_spans: list[Dict[str, Any]] = []
    timestamp = _utc_timestamp()

    def add_finding(
        code: str,
        title: str,
        summary: str,
        segment: Dict[str, Any] | None,
        confidence: float,
    ) -> None:
        if segment is None:
            return

        excerpt = str(segment.get("text") or "").strip()
        if not excerpt:
            return

        evidence_id = f"evidence-{session_token}-{len(evidence_spans) + 1}"
        finding_id = f"finding-{session_token}-{len(findings) + 1}"
        evidence = {
            "id": evidence_id,
            "transcriptSegmentId": str(segment.get("id") or "missing-segment"),
            "excerpt": excerpt,
            "startOffsetMs": int(segment.get("startOffsetMs") or 0),
            "endOffsetMs": int(segment.get("endOffsetMs") or 0),
        }
        evidence_spans.append(evidence)
        findings.append(
            {
                "id": finding_id,
                "sessionId": session_id,
                "code": code,
                "title": title,
                "summary": summary,
                "status": "pending_review",
                "confidence": confidence,
                "evidenceSpans": [evidence],
                "detectedBy": "rules",
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
        )

    joined_text = join_segment_text(transcript_segments)
    clinician_segments = select_segments(
        transcript_segments,
        ["clinician", "staff"],
        fallback_segments=transcript_segments,
    )
    patient_segments = select_segments(
        transcript_segments,
        ["patient", "caregiver", "speaker_a", "speaker_b"],
        fallback_segments=transcript_segments,
    )
    clinician_text = join_segment_text(clinician_segments)
    patient_text = join_segment_text(patient_segments)

    closing_segments = transcript_segments[-3:]
    closing_clinician_segments = select_segments(
        closing_segments,
        ["clinician", "staff"],
        fallback_segments=closing_segments,
    )
    closing_text = join_segment_text(closing_clinician_segments)

    procedure_segment = find_matching_segment(
        transcript_segments,
        ["procedure", "surgery", "operation", "biopsy", "injection", "sedation"],
    )
    mentions_risk_language = contains_any(
        clinician_text,
        [
            "risk",
            "side effect",
            "side effects",
            "complication",
            "complications",
            "bleeding",
            "infection",
        ],
    )
    if procedure_segment is not None and not mentions_risk_language:
        add_finding(
            code="missing-risk-discussion",
            title="Treatment risks were not discussed",
            summary=(
                "The transcript references a procedure or intervention without a "
                "nearby discussion of risks, side effects, or complications."
            ),
            segment=procedure_segment,
            confidence=0.68,
        )

    if transcript_segments and not contains_any(
        closing_text,
        [
            "follow up",
            "follow-up",
            "next step",
            "next steps",
            "call us",
            "call if",
            "return if",
            "come back",
            "see you",
            "reach out",
        ],
    ):
        add_finding(
            code="missing-follow-up-instructions",
            title="Follow-up instructions were not clear",
            summary=(
                "The closing portion of the transcript does not contain a clear "
                "follow-up or return-if-needed instruction."
            ),
            segment=closing_segments[-1],
            confidence=0.64,
        )

    concern_segment = find_matching_segment(
        patient_segments,
        [
            "worried",
            "concerned",
            "pain",
            "dizzy",
            "dizziness",
            "scared",
            "exhausted",
            "overwhelming",
            "burning up",
            "fever",
            "out of control",
            "lose control",
        ],
    )
    empathy_present = contains_any(
        clinician_text,
        [
            "i hear",
            "i understand",
            "that sounds",
            "i'm sorry",
            "i am sorry",
            "we'll make a plan",
            "we will make a plan",
        ],
    )
    if concern_segment is not None and not empathy_present:
        add_finding(
            code="concern-acknowledgement-missing",
            title="Patient concern acknowledgement needs review",
            summary=(
                "The transcript includes a patient concern without a clear "
                "acknowledgement or restatement from the clinician."
            ),
            segment=concern_segment,
            confidence=0.59,
        )

    urgent_segment = find_matching_segment(
        patient_segments,
        [
            "emergency",
            "lose my brain",
            "go insane",
            "going insane",
            "cannot control",
            "can't control",
            "out of control",
            "burning up",
            "we are going to die",
            "we're gonna die",
            "gonna die",
            "fever",
        ],
    )
    urgent_disposition_present = contains_any(
        clinician_text,
        [
            "call 911",
            "go to the er",
            "go to the emergency room",
            "go to the emergency department",
            "seek emergency care",
            "urgent care",
            "same day",
            "same-day",
            "immediately",
            "right now",
            "do not wait",
            "on-call",
            "go in today",
            "be seen today",
        ],
    )
    if urgent_segment is not None and not urgent_disposition_present:
        add_finding(
            code="urgent-symptom-escalation-needed",
            title="Urgent symptom escalation plan needs review",
            summary=(
                "The transcript includes emergency or loss-of-control language "
                "without a clear urgent disposition such as ER, on-call, or "
                "same-day evaluation guidance."
            ),
            segment=urgent_segment,
            confidence=0.84,
        )

    medication_segment = find_matching_segment(
        patient_segments,
        ["missed dose", "missed doses", "refill delayed", "refill delay", "ran out"],
    )
    if medication_segment is not None:
        add_finding(
            code="medication-adherence",
            title="Medication adherence needs review",
            summary=(
                "The transcript describes a refill or missed-dose issue that should "
                "be reviewed before export."
            ),
            segment=medication_segment,
            confidence=0.74,
        )

    return {
        "findings": findings,
        "evidenceSpans": evidence_spans,
    }


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


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def contains_any(text: str, candidates: list[str]) -> bool:
    return any(candidate in text for candidate in candidates)


def join_segment_text(transcript_segments: list[Dict[str, Any]]) -> str:
    return " ".join(
        str(segment.get("text") or "").strip() for segment in transcript_segments
    ).lower()


def normalize_speaker_label(segment: Dict[str, Any]) -> str:
    return str(segment.get("speakerLabel") or "").strip().lower()


def normalize_identifier(value: Any) -> str:
    normalized = "".join(
        character.lower()
        for character in str(value)
        if character.isalnum()
    )
    return normalized or "session"


def select_segments(
    transcript_segments: list[Dict[str, Any]],
    speaker_labels: list[str],
    fallback_segments: list[Dict[str, Any]] | None = None,
) -> list[Dict[str, Any]]:
    selected = [
        segment
        for segment in transcript_segments
        if normalize_speaker_label(segment) in speaker_labels
    ]
    if selected:
        return selected

    known_labels = {
        label
        for label in (normalize_speaker_label(segment) for segment in transcript_segments)
        if label and label != "unknown"
    }
    if not known_labels:
        return fallback_segments if fallback_segments is not None else transcript_segments

    return []


def find_matching_segment(
    transcript_segments: list[Dict[str, Any]],
    keywords: list[str],
) -> Dict[str, Any] | None:
    for segment in transcript_segments:
        text = str(segment.get("text") or "").strip().lower()
        if text and contains_any(text, keywords):
            return segment
    return None


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
