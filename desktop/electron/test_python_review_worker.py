"""Tests for the embedded Python review worker.

`python-review-worker.py` is the local analysis engine: it turns transcript
segments into evidence-backed findings that a human reviewer then accepts,
rejects, or marks uncertain. It runs as a subprocess of the Electron main
process and, until now, had no automated coverage at all even though it owns
the most safety-relevant logic in the desktop app (what gets surfaced for
review on a sensitive medical encounter).

The worker file name contains hyphens, so it cannot be imported normally; it is
loaded by path below. Only stdlib is imported at module scope (the whisper
backends are imported lazily inside the transcribe functions), so loading it
here is side-effect free.

Run with: python3 -m pytest desktop/electron -q
"""

import importlib.util
import json
import os
import stat
import sys
from pathlib import Path

import pytest

_WORKER_PATH = Path(__file__).resolve().with_name("python-review-worker.py")
_spec = importlib.util.spec_from_file_location("doctor_auditor_review_worker", _WORKER_PATH)
assert _spec is not None and _spec.loader is not None
worker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(worker)


# Environment variables the worker reads. Cleared before every test so each one
# is hermetic and never leaks the developer's real configuration.
_WORKER_ENV_VARS = (
    "DOCTOR_AUDITOR_REVIEW_ML_PROVIDER",
    "DOCTOR_AUDITOR_REVIEW_ML_COMMAND",
    "DOCTOR_AUDITOR_REVIEW_ML_MODEL",
    "DOCTOR_AUDITOR_REVIEW_ML_CACHE_DIR",
    "DOCTOR_AUDITOR_REVIEW_ML_DEVICE",
    "DOCTOR_AUDITOR_REVIEW_ML_COMPUTE_TYPE",
)


@pytest.fixture(autouse=True)
def _clean_worker_env(monkeypatch):
    for name in _WORKER_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def segment(index, speaker, text, *, start=0, end=1000, seg_id=None):
    return {
        "id": seg_id or f"segment-{index}",
        "speakerLabel": speaker,
        "text": text,
        "startOffsetMs": start,
        "endOffsetMs": end,
    }


def analyze(segments, session_id="sess-1"):
    return worker.analyze_transcript(
        {"sessionId": session_id, "transcriptSegments": segments}
    )


def codes_for(segments):
    return {finding["code"] for finding in analyze(segments)["findings"]}


# ---------------------------------------------------------------------------
# Small pure helpers
# ---------------------------------------------------------------------------


def test_contains_any():
    assert worker.contains_any("hello world", ["nope", "world"]) is True
    assert worker.contains_any("hello world", ["xyz"]) is False
    assert worker.contains_any("", ["x"]) is False


def test_join_segment_text_lowercases_and_strips():
    assert worker.join_segment_text([{"text": " A "}, {"text": "B"}]) == "a b"
    # A None/missing text contributes an empty token, never raises.
    assert worker.join_segment_text([{"text": None}]) == ""
    assert worker.join_segment_text([]) == ""


def test_normalize_speaker_label():
    assert worker.normalize_speaker_label({"speakerLabel": " Clinician "}) == "clinician"
    assert worker.normalize_speaker_label({"speakerLabel": None}) == ""
    assert worker.normalize_speaker_label({}) == ""


def test_normalize_identifier_keeps_only_alnum():
    assert worker.normalize_identifier("ABC-123!") == "abc123"
    assert worker.normalize_identifier("Session_42") == "session42"
    # Falls back to a stable token when nothing alphanumeric survives.
    assert worker.normalize_identifier("!!!") == "session"
    assert worker.normalize_identifier("") == "session"


def test_infer_model_name_from_ggml():
    assert worker.infer_model_name_from_ggml("ggml-base.en.bin") == "base.en"
    assert worker.infer_model_name_from_ggml("ggml-large-v3.bin") == "large-v3"
    assert worker.infer_model_name_from_ggml("base.en.bin") is None  # no ggml- prefix
    assert worker.infer_model_name_from_ggml("ggml-base.en") is None  # no .bin suffix
    assert worker.infer_model_name_from_ggml("model.txt") is None


# ---------------------------------------------------------------------------
# Segment selection / matching
# ---------------------------------------------------------------------------


def test_select_segments_returns_matching_speakers():
    clinician = segment(1, "clinician", "x")
    patient = segment(2, "patient", "y")
    assert worker.select_segments([clinician, patient], ["clinician"]) == [clinician]


def test_select_segments_falls_back_when_no_speakers_are_differentiated():
    # Every segment is unlabeled/unknown, so role selection is impossible and
    # the worker treats the whole transcript as the fallback population.
    unknown = segment(1, "unknown", "x")
    blank = segment(2, "", "y")
    fallback = [unknown, blank]
    assert (
        worker.select_segments([unknown, blank], ["clinician"], fallback_segments=fallback)
        == fallback
    )


def test_select_segments_returns_empty_when_other_roles_are_labeled():
    # Speakers ARE differentiated (a real "patient" label exists) but the
    # requested role is absent, so the requested role is genuinely empty rather
    # than falling back to everyone.
    patient = segment(1, "patient", "y")
    assert worker.select_segments([patient], ["clinician"], fallback_segments=[patient]) == []


def test_find_matching_segment_returns_first_match_and_skips_blank_text():
    first = segment(1, "patient", "I feel fine")
    blank = segment(2, "patient", "   ")
    hit = segment(3, "patient", "I have a fever today")
    assert worker.find_matching_segment([first, blank, hit], ["fever"]) is hit
    assert worker.find_matching_segment([first], ["fever"]) is None


# ---------------------------------------------------------------------------
# analyze_transcript: the rules engine
# ---------------------------------------------------------------------------


def test_analyze_empty_transcript_returns_no_findings():
    result = analyze([])
    assert result == {"findings": [], "evidenceSpans": []}


def test_missing_risk_discussion_fires_when_procedure_has_no_risk_language():
    assert "missing-risk-discussion" in codes_for(
        [
            segment(1, "clinician", "Let's schedule the biopsy procedure."),
            segment(2, "patient", "Okay sounds good."),
            segment(3, "clinician", "Call us if you need anything."),
        ]
    )


def test_missing_risk_discussion_suppressed_when_risks_are_discussed():
    assert "missing-risk-discussion" not in codes_for(
        [
            segment(
                1,
                "clinician",
                "Let's schedule the biopsy. There is a small risk of bleeding and infection.",
            ),
            segment(2, "patient", "Okay."),
            segment(3, "clinician", "Call us if you need anything."),
        ]
    )


def test_missing_follow_up_fires_when_closing_has_no_instructions():
    assert "missing-follow-up-instructions" in codes_for(
        [
            segment(1, "clinician", "How are you feeling today?"),
            segment(2, "patient", "Pretty good overall."),
            segment(3, "clinician", "Alright, take care."),
        ]
    )


def test_missing_follow_up_suppressed_when_return_instructions_present():
    assert "missing-follow-up-instructions" not in codes_for(
        [
            segment(1, "clinician", "How are you feeling today?"),
            segment(2, "patient", "Pretty good overall."),
            segment(3, "clinician", "Call us if your symptoms get worse."),
        ]
    )


def test_concern_acknowledgement_fires_without_empathy():
    assert "concern-acknowledgement-missing" in codes_for(
        [
            segment(1, "patient", "I'm really worried about this."),
            segment(2, "clinician", "Let's continue. Call us if you have questions."),
        ]
    )


def test_concern_acknowledgement_suppressed_with_empathy():
    assert "concern-acknowledgement-missing" not in codes_for(
        [
            segment(1, "patient", "I'm really worried about this."),
            segment(2, "clinician", "I understand. Call us if you have questions."),
        ]
    )


def test_urgent_escalation_fires_without_disposition():
    assert "urgent-symptom-escalation-needed" in codes_for(
        [
            segment(1, "patient", "I feel like I'm going insane and can't control it."),
            segment(
                2,
                "clinician",
                "Let's schedule a regular follow-up. Call us if you have questions.",
            ),
        ]
    )


def test_urgent_escalation_suppressed_with_disposition():
    assert "urgent-symptom-escalation-needed" not in codes_for(
        [
            segment(1, "patient", "I feel like I'm going insane and can't control it."),
            segment(2, "clinician", "Go to the ER right now. Call us if you have questions."),
        ]
    )


def test_medication_adherence_fires_on_refill_issue():
    assert "medication-adherence" in codes_for(
        [
            segment(1, "patient", "I ran out of my medication."),
            segment(2, "clinician", "Thanks for letting me know. Call us if you have questions."),
        ]
    )


def test_finding_and_evidence_have_the_expected_shape():
    session_id = "encounter-2026-03-15"
    token = worker.normalize_identifier(session_id)
    result = analyze(
        [
            segment(1, "patient", "I ran out of my medication.", start=2000, end=4000, seg_id="seg-xyz"),
            segment(2, "clinician", "Noted. Call us if you have questions."),
        ],
        session_id=session_id,
    )

    assert len(result["findings"]) == 1
    finding = result["findings"][0]
    assert finding["id"] == f"finding-{token}-1"
    assert finding["sessionId"] == session_id
    assert finding["code"] == "medication-adherence"
    assert finding["status"] == "pending_review"
    assert finding["detectedBy"] == "rules"
    assert isinstance(finding["confidence"], float)
    assert finding["createdAt"].endswith("Z")
    assert finding["createdAt"] == finding["updatedAt"]

    assert len(finding["evidenceSpans"]) == 1
    evidence = finding["evidenceSpans"][0]
    assert evidence["id"] == f"evidence-{token}-1"
    assert evidence["transcriptSegmentId"] == "seg-xyz"
    assert evidence["excerpt"] == "I ran out of my medication."
    assert evidence["startOffsetMs"] == 2000
    assert evidence["endOffsetMs"] == 4000

    # The top-level evidenceSpans list mirrors the per-finding evidence.
    assert result["evidenceSpans"] == [evidence]


def test_multiple_findings_get_sequential_ids_in_rule_order():
    session_id = "multi"
    token = worker.normalize_identifier(session_id)
    result = analyze(
        [
            segment(1, "clinician", "We'll do the biopsy next week."),
            segment(2, "patient", "I ran out of my medication."),
            segment(3, "clinician", "Call us if you have questions."),
        ],
        session_id=session_id,
    )

    ids = [finding["id"] for finding in result["findings"]]
    codes = [finding["code"] for finding in result["findings"]]
    # Rules run risk-first, medication-last, so ids are assigned in that order.
    assert ids == [f"finding-{token}-1", f"finding-{token}-2"]
    assert codes == ["missing-risk-discussion", "medication-adherence"]


# ---------------------------------------------------------------------------
# Model / provider resolution
# ---------------------------------------------------------------------------


def test_resolve_python_model_reference_prefers_request_model_ref():
    assert worker.resolve_python_model_reference({"modelRef": "  small.en  "}) == "small.en"


def test_resolve_python_model_reference_uses_env(monkeypatch):
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_MODEL", "medium.en")
    assert worker.resolve_python_model_reference({"modelPath": "/nope"}) == "medium.en"


def test_resolve_python_model_reference_uses_model_directory(tmp_path):
    model_dir = tmp_path / "faster-whisper-base"
    model_dir.mkdir()
    assert worker.resolve_python_model_reference({"modelPath": str(model_dir)}) == str(model_dir)


def test_resolve_python_model_reference_infers_from_ggml_file(tmp_path):
    ggml = tmp_path / "ggml-base.en.bin"
    ggml.write_bytes(b"\x00")
    assert worker.resolve_python_model_reference({"modelPath": str(ggml)}) == "base.en"


def test_resolve_python_model_reference_missing_raises_or_returns_none(tmp_path):
    stray = tmp_path / "model.bin"  # exists, but not a ggml- file and not a dir
    stray.write_bytes(b"\x00")
    request = {"modelPath": str(stray)}
    with pytest.raises(RuntimeError):
        worker.resolve_python_model_reference(request)
    assert worker.resolve_python_model_reference(request, raise_on_missing=False) is None


def test_resolve_download_root_variants(tmp_path, monkeypatch):
    # Explicit cache dir wins outright.
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_CACHE_DIR", "/cache/here")
    assert worker.resolve_download_root({"modelPath": str(tmp_path)}) == "/cache/here"
    monkeypatch.delenv("DOCTOR_AUDITOR_REVIEW_ML_CACHE_DIR")

    # A model directory is itself the download root.
    assert worker.resolve_download_root({"modelPath": str(tmp_path)}) == str(tmp_path)

    # A model *file* resolves to its parent directory.
    model_file = tmp_path / "ggml-base.en.bin"
    assert worker.resolve_download_root({"modelPath": str(model_file)}) == str(tmp_path)

    # A bare model name (no suffix, not a path) has no derivable root.
    assert worker.resolve_download_root({"modelPath": "base.en"}) is None
    assert worker.resolve_download_root({}) is None


def test_resolve_provider_rejects_unsupported_configured_provider(monkeypatch):
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_PROVIDER", "totally-made-up")
    with pytest.raises(RuntimeError):
        worker.resolve_provider({})
    assert worker.resolve_provider({}, raise_on_missing=False) is None


def test_resolve_provider_accepts_command_adapter_when_command_set(monkeypatch):
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_PROVIDER", "command_adapter")
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_COMMAND", "/usr/bin/true")
    assert worker.resolve_provider({}) == "command_adapter"


def test_resolve_provider_command_adapter_without_command_is_unusable(monkeypatch):
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_PROVIDER", "command_adapter")
    with pytest.raises(RuntimeError):
        worker.resolve_provider({})
    assert worker.resolve_provider({}, raise_on_missing=False) is None


def test_resolve_provider_auto_detects_command_adapter(monkeypatch):
    # No explicit provider; whisper backends unavailable; command adapter wins.
    monkeypatch.setattr(worker, "module_available", lambda name: False)
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_COMMAND", "/usr/bin/true")
    assert worker.resolve_provider({}) == "command_adapter"


def test_resolve_provider_no_backend_raises(monkeypatch):
    monkeypatch.setattr(worker, "module_available", lambda name: False)
    with pytest.raises(RuntimeError):
        worker.resolve_provider({})
    assert worker.resolve_provider({}, raise_on_missing=False) is None


def test_is_model_available_for_command_adapter(tmp_path, monkeypatch):
    model_file = tmp_path / "model.bin"
    model_file.write_bytes(b"\x00")
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_PROVIDER", "command_adapter")
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_COMMAND", "/usr/bin/true")

    assert worker.is_model_available({"modelPath": str(model_file)}) is True
    # Missing model file -> not available.
    assert worker.is_model_available({"modelPath": str(tmp_path / "absent.bin")}) is False


def test_is_model_available_false_for_unsupported_provider(monkeypatch):
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_PROVIDER", "totally-made-up")
    assert worker.is_model_available({"modelPath": "/whatever"}) is False


# ---------------------------------------------------------------------------
# Request dispatch (the stdin/stdout JSON protocol)
# ---------------------------------------------------------------------------


def _read_response(capsys):
    out = capsys.readouterr().out.strip().splitlines()
    assert out, "worker wrote no response line"
    return json.loads(out[-1])


def test_handle_request_dispatches_analyze_transcript(capsys):
    worker.handle_request(
        {
            "requestId": "req-1",
            "kind": "analyze-transcript",
            "sessionId": "sess-1",
            "transcriptSegments": [
                segment(1, "patient", "I ran out of my medication."),
                segment(2, "clinician", "Noted. Call us if you have questions."),
            ],
        }
    )
    response = _read_response(capsys)
    assert response["requestId"] == "req-1"
    assert response["ok"] is True
    assert {f["code"] for f in response["result"]["findings"]} == {"medication-adherence"}


def test_handle_request_reports_unsupported_kind(capsys):
    worker.handle_request({"requestId": "req-2", "kind": "no-such-kind"})
    response = _read_response(capsys)
    assert response["requestId"] == "req-2"
    assert response["ok"] is False
    assert "Unsupported review ML request" in response["error"]
    assert "stack" in response


# ---------------------------------------------------------------------------
# Command-adapter subprocess plumbing (POSIX only)
# ---------------------------------------------------------------------------


def _write_exec_script(path, body):
    path.write_text(f"#!{sys.executable}\n{body}")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


@pytest.mark.skipif(os.name == "nt", reason="exec-bit script adapter is POSIX only")
def test_command_adapter_round_trips_json(tmp_path, monkeypatch):
    script = tmp_path / "adapter.py"
    _write_exec_script(
        script,
        "import json, sys\n"
        "req = json.loads(sys.stdin.read() or '{}')\n"
        "print(json.dumps([{'id': 'seg-1', 'echo': req.get('sessionId')}]))\n",
    )
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_COMMAND", str(script))

    result = worker.transcribe_with_command_adapter({"sessionId": "sess-42"})
    assert result == [{"id": "seg-1", "echo": "sess-42"}]


@pytest.mark.skipif(os.name == "nt", reason="exec-bit script adapter is POSIX only")
def test_command_adapter_empty_output_is_empty_list(tmp_path, monkeypatch):
    script = tmp_path / "adapter.py"
    _write_exec_script(script, "pass\n")
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_COMMAND", str(script))
    assert worker.transcribe_with_command_adapter({"sessionId": "s"}) == []


@pytest.mark.skipif(os.name == "nt", reason="exec-bit script adapter is POSIX only")
def test_command_adapter_surfaces_stderr_on_failure(tmp_path, monkeypatch):
    script = tmp_path / "adapter.py"
    _write_exec_script(
        script,
        "import sys\nsys.stderr.write('adapter boom')\nsys.exit(2)\n",
    )
    monkeypatch.setenv("DOCTOR_AUDITOR_REVIEW_ML_COMMAND", str(script))
    with pytest.raises(RuntimeError, match="adapter boom"):
        worker.transcribe_with_command_adapter({"sessionId": "s"})


def test_command_adapter_requires_command_env():
    # Autouse fixture guarantees the env var is unset here.
    with pytest.raises(RuntimeError, match="DOCTOR_AUDITOR_REVIEW_ML_COMMAND"):
        worker.transcribe_with_command_adapter({"sessionId": "s"})
