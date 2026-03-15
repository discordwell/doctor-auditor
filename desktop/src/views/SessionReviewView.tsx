import React, { useEffect, useState } from "react";
import type {
  EvidenceSpan,
  ExportStatus,
  Finding,
  ModelAssistReceipt,
  ReviewDecisionOutcome,
  ReviewStatus,
  TranscriptSegment,
  TranscriptSpeakerLabel,
  TranscriptStatus,
} from "@doctor-auditor/shared/local-review";
import type { DesktopSessionBundle } from "../types/electron";
import {
  buildReviewWorkspace,
  getPersistedOutcome,
} from "./sessionReviewModel";
import "./SessionReviewView.css";

type LoadState = "loading" | "ready" | "error";
type DecisionTone = "accepted" | "rejected" | "uncertain" | "pending";

interface SessionReviewViewProps {
  sessionId: string;
  onBack: () => void;
}

export default function SessionReviewView({
  sessionId,
  onBack,
}: SessionReviewViewProps) {
  const [bundle, setBundle] = useState<DesktopSessionBundle | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [actionInfoMessage, setActionInfoMessage] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [savingFindingId, setSavingFindingId] = useState<string | null>(null);
  const [requestingAssistFindingId, setRequestingAssistFindingId] = useState<
    string | null
  >(null);
  const [isCreatingExport, setIsCreatingExport] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadSession(): Promise<void> {
      if (!window.doctorAuditor) {
        setLoadState("error");
        setErrorMessage("Desktop session API unavailable.");
        return;
      }

      setLoadState("loading");
      setErrorMessage("");
      setActionErrorMessage("");
      setActionInfoMessage("");

      try {
        const nextBundle = await window.doctorAuditor.session.get(sessionId);

        if (isCancelled) {
          return;
        }

        if (!nextBundle) {
          setLoadState("error");
          setErrorMessage("The selected review session no longer exists.");
          return;
        }

        setBundle(nextBundle);
        setLoadState("ready");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setLoadState("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load the selected review session."
        );
      }
    }

    void loadSession();

    return () => {
      isCancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!bundle) {
      return;
    }

    const workspace = buildReviewWorkspace(bundle);
    setSelectedFindingId((current) => {
      if (current && workspace.findings.some((finding) => finding.id === current)) {
        return current;
      }

      return workspace.findings[0]?.id ?? null;
    });
  }, [bundle]);

  async function saveReviewDecision(
    findingId: string,
    outcome: ReviewDecisionOutcome
  ): Promise<void> {
    if (!window.doctorAuditor || !bundle) {
      setActionErrorMessage("Desktop review persistence is unavailable.");
      return;
    }

    setActionErrorMessage("");
    setActionInfoMessage("");
    setSavingFindingId(findingId);

    try {
      const nextBundle = await window.doctorAuditor.session.saveReviewDecision({
        sessionId: bundle.session.id,
        findingId,
        outcome,
      });

      if (!nextBundle) {
        throw new Error("The selected finding could not be saved.");
      }

      setBundle(nextBundle);
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to save the local review decision."
      );
    } finally {
      setSavingFindingId(null);
    }
  }

  async function requestSeriousnessAssist(findingId: string): Promise<void> {
    if (!window.doctorAuditor || !bundle) {
      setActionErrorMessage("Desktop review persistence is unavailable.");
      return;
    }

    setActionErrorMessage("");
    setActionInfoMessage("");
    setRequestingAssistFindingId(findingId);

    try {
      const result =
        await window.doctorAuditor.session.requestSeriousnessAssist({
          sessionId: bundle.session.id,
          findingId,
        });

      if (result.bundle) {
        setBundle(result.bundle);
      }

      if (result.receipt.status === "failed") {
        setActionErrorMessage(
          result.syncError
            ? `Remote assist failed locally, and ops sync also failed: ${result.syncError}`
            : "Remote assist request failed. The failure was recorded locally."
        );
        return;
      }

      setActionInfoMessage(
        result.syncError
          ? `Remote assist result saved locally, but cloud ops sync failed: ${result.syncError}`
          : "Remote assist result received and stored locally."
      );
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to request remote assist."
      );
    } finally {
      setRequestingAssistFindingId(null);
    }
  }

  async function dismissAssistReceipt(receiptId: string): Promise<void> {
    if (!window.doctorAuditor || !bundle) {
      setActionErrorMessage("Desktop review persistence is unavailable.");
      return;
    }

    setActionErrorMessage("");
    setActionInfoMessage("");

    try {
      const nextBundle = await window.doctorAuditor.session.updateModelAssistAction({
        sessionId: bundle.session.id,
        receiptId,
        reviewerAction: "dismissed",
      });

      if (!nextBundle) {
        throw new Error("The Remote assist record could not be updated.");
      }

      setBundle(nextBundle);
      setActionInfoMessage("Remote assist recommendation dismissed locally.");
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to update the Remote assist recommendation."
      );
    }
  }

  async function createApprovedExport(): Promise<void> {
    if (!window.doctorAuditor || !bundle) {
      setActionErrorMessage("Desktop review persistence is unavailable.");
      return;
    }

    setActionErrorMessage("");
    setActionInfoMessage("");
    setIsCreatingExport(true);

    try {
      const result = await window.doctorAuditor.session.createApprovedExport({
        sessionId: bundle.session.id,
      });

      if (result.bundle) {
        setBundle(result.bundle);
      }

      setActionInfoMessage(
        result.syncError
          ? `Approved export saved locally, but cloud sync failed: ${result.syncError}`
          : "Approved export saved locally and synced to the cloud export plane."
      );
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create an approved export."
      );
    } finally {
      setIsCreatingExport(false);
    }
  }

  const workspace = bundle ? buildReviewWorkspace(bundle) : null;
  const findings = workspace?.findings ?? [];
  const transcriptSegments = workspace?.transcriptSegments ?? [];
  const modelAssistReceipts = bundle?.modelAssistReceipts ?? [];
  const selectedFinding =
    findings.find((finding) => finding.id === selectedFindingId) ?? findings[0];
  const selectedOutcome =
    selectedFinding && bundle
      ? getPersistedOutcome(selectedFinding, bundle.reviewDecisions)
      : undefined;
  const selectedAssistReceipts = selectedFinding
    ? modelAssistReceipts
        .filter((receipt) => receipt.findingId === selectedFinding.id)
        .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
    : [];
  const latestAssistReceipt = selectedAssistReceipts[0];
  const reviewedCount = findings.filter((finding) =>
    Boolean(bundle && getPersistedOutcome(finding, bundle.reviewDecisions))
  ).length;

  if (loadState === "loading") {
    return (
      <section className="session-review">
        <div className="session-review__state" role="status" aria-live="polite">
          <p className="session-review__state-label">Loading review session</p>
          <h2>Pulling transcript drill-down</h2>
          <p>Reading local transcript, findings, and evidence links for review.</p>
        </div>
      </section>
    );
  }

  if (loadState === "error" || !bundle || !workspace) {
    return (
      <section className="session-review">
        <div className="session-review__state" role="alert">
          <p className="session-review__state-label">Review unavailable</p>
          <h2>Unable to open this session</h2>
          <p>{errorMessage}</p>
          <div className="session-review__state-actions">
            <button
              type="button"
              className="session-review__button"
              onClick={onBack}
            >
              Back to history
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="session-review">
      <div className="session-review__topbar">
        <button
          type="button"
          className="session-review__button session-review__button--secondary"
          onClick={onBack}
        >
          Back to history
        </button>
        <button
          type="button"
          className="session-review__button"
          onClick={() => void createApprovedExport()}
          disabled={
            isCreatingExport ||
            bundle.session.reviewStatus !== "completed" ||
            !bundle.session.consent.exportAllowed
          }
        >
          {isCreatingExport ? "Saving export..." : "Approve export envelope"}
        </button>
      </div>

      <header className="session-review__header">
        <div>
          <p className="session-review__eyebrow">Transcript drill-down</p>
          <h2>{formatClinicianLabel(bundle.session.clinicianId)}</h2>
          <p className="session-review__subtitle">
            Encounter {bundle.session.id.slice(0, 8).toUpperCase()} / Started{" "}
            {formatDateTime(bundle.session.encounterStartedAt)} / Created{" "}
            {formatDateTime(bundle.session.createdAt)}
          </p>
        </div>

        <div className="session-review__status-cluster">
          <span
            className={`session-review__badge session-review__badge--${getTranscriptTone(
              bundle.session.transcriptStatus
            )}`}
          >
            {formatTranscriptStatus(bundle.session.transcriptStatus)}
          </span>
          <span
            className={`session-review__badge session-review__badge--${getReviewTone(
              bundle.session.reviewStatus
            )}`}
          >
            {formatReviewStatus(bundle.session.reviewStatus)}
          </span>
          <span
            className={`session-review__badge session-review__badge--${getExportTone(
              bundle.session.exportStatus
            )}`}
          >
            {formatExportStatus(bundle.session.exportStatus)}
          </span>
        </div>
      </header>

      <section className="session-review__summary">
        <article className="session-review__summary-card">
          <p className="session-review__summary-label">Transcript segments</p>
          <p className="session-review__summary-value">{transcriptSegments.length}</p>
          <p className="session-review__summary-caption">
            {workspace.hasTranscript
              ? "Timestamped transcript segments currently attached to this session."
              : "No transcript segments are attached to this session yet."}
          </p>
        </article>
        <article className="session-review__summary-card">
          <p className="session-review__summary-label">Findings in focus</p>
          <p className="session-review__summary-value">{findings.length}</p>
          <p className="session-review__summary-caption">
            {workspace.hasFindings
              ? "Persisted findings returned with the local session bundle."
              : "No persisted findings are attached to this session yet."}
          </p>
        </article>
        <article className="session-review__summary-card">
          <p className="session-review__summary-label">Reviewer actions</p>
          <p className="session-review__summary-value">{reviewedCount}</p>
          <p className="session-review__summary-caption">
            Accept, reject, or mark uncertain before export work starts.
          </p>
        </article>
      </section>

      {!workspace.hasTranscript && (
        <div className="session-review__notice" role="status">
          Transcript pipeline output is not attached yet. This view only shows
          persisted session data and will update when transcript segments land.
        </div>
      )}

      {!workspace.hasFindings && (
        <div className="session-review__notice" role="status">
          No persisted findings are attached to this session yet. Reviewer
          actions stay unavailable until findings are saved.
        </div>
      )}

      {actionErrorMessage && (
        <div className="session-review__notice" role="alert">
          {actionErrorMessage}
        </div>
      )}

      {actionInfoMessage && (
        <div className="session-review__notice" role="status">
          {actionInfoMessage}
        </div>
      )}

      <div className="session-review__layout">
        <section className="session-review__panel">
          <div className="session-review__panel-header">
            <div>
              <p className="session-review__panel-kicker">Transcript</p>
              <h3>Evidence timeline</h3>
            </div>
            <p className="session-review__panel-note">
              {selectedFinding
                ? `${selectedFinding.evidenceSpans.length} evidence span(s) highlighted for the selected finding.`
                : "Select a finding to highlight linked evidence spans."}
            </p>
          </div>

          <div className="session-review__transcript-list">
            {transcriptSegments.length > 0 ? (
              transcriptSegments.map((segment) => {
                const linkedEvidence = selectedFinding
                  ? selectedFinding.evidenceSpans.filter(
                      (span) => span.transcriptSegmentId === segment.id
                    )
                  : [];

                return (
                  <article
                    key={segment.id}
                    className={`session-review__segment ${
                      linkedEvidence.length > 0 ? "is-highlighted" : ""
                    }`}
                  >
                    <div className="session-review__segment-meta">
                      <div>
                        <p className="session-review__segment-time">
                          {formatOffset(segment.startOffsetMs)} -{" "}
                          {formatOffset(segment.endOffsetMs)}
                        </p>
                        <p
                          className={`session-review__speaker session-review__speaker--${segment.speakerLabel}`}
                        >
                          {formatSpeakerLabel(segment.speakerLabel)}
                        </p>
                      </div>
                      <div className="session-review__confidence">
                        <span>
                          Transcript {formatConfidence(segment.transcriptConfidence)}
                        </span>
                        <span>
                          Speaker {formatConfidence(segment.speakerConfidence)}
                        </span>
                      </div>
                    </div>

                    <p className="session-review__segment-text">
                      {renderSegmentText(segment.text, linkedEvidence)}
                    </p>

                    {linkedEvidence.length > 0 && (
                      <div className="session-review__evidence-row">
                        {linkedEvidence.map((span) => (
                          <span
                            key={span.id}
                            className="session-review__evidence-chip"
                          >
                            {span.excerpt}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="session-review__empty-detail">
                Transcript segments have not been saved for this session yet.
              </div>
            )}
          </div>
        </section>

        <aside className="session-review__sidebar">
          <section className="session-review__panel">
            <div className="session-review__panel-header">
              <div>
                <p className="session-review__panel-kicker">Findings</p>
                <h3>Reviewer queue</h3>
              </div>
              <p className="session-review__panel-note">
                Evidence-linked findings stay local until a reviewer approves the
                export path.
              </p>
            </div>

            <div className="session-review__findings-list">
              {findings.length > 0 ? (
                findings.map((finding) => {
                  const appliedOutcome = getPersistedOutcome(
                    finding,
                    bundle.reviewDecisions
                  );
                  const tone = getDecisionTone(appliedOutcome);
                  const isSavingDecision = savingFindingId === finding.id;
                  const isRequestingAssist =
                    requestingAssistFindingId === finding.id;

                  return (
                    <article
                      key={finding.id}
                      className={`session-review__finding ${
                        selectedFinding?.id === finding.id ? "is-selected" : ""
                      }`}
                      onClick={() => setSelectedFindingId(finding.id)}
                    >
                      <div className="session-review__finding-top">
                        <div>
                          <p className="session-review__finding-code">{finding.code}</p>
                          <h4>{finding.title}</h4>
                        </div>
                        <span
                          className={`session-review__decision session-review__decision--${tone}`}
                        >
                          {formatDecisionLabel(appliedOutcome)}
                        </span>
                      </div>

                      <p className="session-review__finding-summary">
                        {finding.summary}
                      </p>

                      <div className="session-review__finding-meta">
                        <span>{Math.round(finding.confidence * 100)}% confidence</span>
                        <span>{finding.detectedBy}</span>
                        <span>{finding.evidenceSpans.length} span(s)</span>
                      </div>

                      <div className="session-review__actions">
                        {(
                          [
                            ["accepted", "Accept"],
                            ["rejected", "Reject"],
                            ["uncertain", "Uncertain"],
                          ] as Array<[ReviewDecisionOutcome, string]>
                        ).map(([outcome, label]) => (
                          <button
                            key={outcome}
                            type="button"
                            className={`session-review__action-button ${
                              appliedOutcome === outcome ? "is-active" : ""
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedFindingId(finding.id);
                              void saveReviewDecision(finding.id, outcome);
                            }}
                            disabled={isSavingDecision}
                          >
                            {isSavingDecision ? "Saving..." : label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="session-review__action-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedFindingId(finding.id);
                            void requestSeriousnessAssist(finding.id);
                          }}
                          disabled={
                            isRequestingAssist ||
                            !bundle.session.consent.remoteAssistAllowed ||
                            finding.evidenceSpans.length === 0
                          }
                        >
                          {isRequestingAssist
                            ? "Requesting..."
                            : "Request Remote assist"}
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="session-review__empty-detail">
                  Findings have not been saved for this session yet.
                </div>
              )}
            </div>
          </section>

          <section className="session-review__panel">
            <div className="session-review__panel-header">
              <div>
                <p className="session-review__panel-kicker">Selected finding</p>
                <h3>
                  {selectedFinding ? selectedFinding.title : "No finding selected"}
                </h3>
              </div>
              <p className="session-review__panel-note">
                {selectedFinding
                  ? "Review outcome is persisted in the local desktop database."
                  : "Open a finding to inspect linked evidence."}
              </p>
            </div>

            {selectedFinding ? (
              <div className="session-review__detail">
                <div className="session-review__detail-row">
                  <span>Decision</span>
                  <strong
                    className={`session-review__detail-value session-review__detail-value--${getDecisionTone(
                      selectedOutcome
                    )}`}
                  >
                    {formatDecisionLabel(selectedOutcome)}
                  </strong>
                </div>
                <div className="session-review__detail-row">
                  <span>Detected by</span>
                  <strong>{selectedFinding.detectedBy}</strong>
                </div>
                <div className="session-review__detail-row">
                  <span>Updated</span>
                  <strong>{formatDateTime(selectedFinding.updatedAt)}</strong>
                </div>
                <div className="session-review__detail-row">
                  <span>Remote assist</span>
                  <strong>
                    {bundle.session.consent.remoteAssistAllowed
                      ? "Permitted"
                      : "Disabled for this session"}
                  </strong>
                </div>

                <div className="session-review__detail-block">
                  <p className="session-review__detail-label">Summary</p>
                  <p>{selectedFinding.summary}</p>
                </div>

                <div className="session-review__detail-block">
                  <p className="session-review__detail-label">Evidence spans</p>
                  <div className="session-review__evidence-list">
                    {selectedFinding.evidenceSpans.map((span) => {
                      const sourceSegment = transcriptSegments.find(
                        (segment) => segment.id === span.transcriptSegmentId
                      );

                      return (
                        <article key={span.id} className="session-review__evidence-card">
                          <p className="session-review__evidence-label">
                            {sourceSegment
                              ? `${formatSpeakerLabel(sourceSegment.speakerLabel)} / ${formatOffset(
                                  span.startOffsetMs
                                )}`
                              : "Detached evidence"}
                          </p>
                          <p>{span.excerpt}</p>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="session-review__detail-block">
                  <div className="session-review__detail-row">
                    <span>Remote assist</span>
                    <strong>
                      {latestAssistReceipt
                        ? formatAssistStatus(latestAssistReceipt)
                        : "No Remote assist request yet"}
                    </strong>
                  </div>
                  {latestAssistReceipt ? (
                    <div className="session-review__evidence-list">
                      <article className="session-review__evidence-card">
                        <p className="session-review__evidence-label">
                          {latestAssistReceipt.assessment
                            ? `${formatAssistDisposition(
                                latestAssistReceipt.assessment.disposition
                              )} / ${Math.round(
                                latestAssistReceipt.assessment.confidence * 100
                              )}% confidence`
                            : "Request failed"}
                        </p>
                        <p>
                          {latestAssistReceipt.assessment?.rationale ??
                            latestAssistReceipt.errorCode ??
                            "The Remote assist gateway did not return an assessment."}
                        </p>
                        {latestAssistReceipt.assessment?.limitations.length ? (
                          <p className="session-review__evidence-label">
                            {latestAssistReceipt.assessment.limitations.join(" / ")}
                          </p>
                        ) : null}
                        {latestAssistReceipt.reviewerAction !== "dismissed" && (
                          <button
                            type="button"
                            className="session-review__action-button"
                            onClick={() =>
                              void dismissAssistReceipt(latestAssistReceipt.id)
                            }
                          >
                            Dismiss Remote assist result
                          </button>
                        )}
                      </article>
                    </div>
                  ) : (
                    <p>
                      Request Remote assist to log a minimized, non-raw result
                      without moving transcript or findings into the cloud.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="session-review__empty-detail">
                Choose a finding to inspect evidence and reviewer controls.
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDateTime(value: string): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatClinicianLabel(clinicianId: string): string {
  const trimmedValue = clinicianId.trim();
  return trimmedValue || "Unassigned clinician";
}

function formatTranscriptStatus(value: TranscriptStatus): string {
  switch (value) {
    case "not_started":
      return "Transcript pending";
    case "in_progress":
      return "Transcript running";
    case "completed":
      return "Transcript ready";
    case "failed":
      return "Transcript failed";
  }
}

function formatReviewStatus(value: ReviewStatus): string {
  switch (value) {
    case "not_started":
      return "Review not started";
    case "ready":
      return "Ready for review";
    case "in_review":
      return "Review in progress";
    case "completed":
      return "Review complete";
  }
}

function formatExportStatus(value: ExportStatus): string {
  switch (value) {
    case "not_requested":
      return "Export not requested";
    case "draft":
      return "Export draft";
    case "approved":
      return "Export approved";
    case "sent":
      return "Export sent";
  }
}

function getTranscriptTone(value: TranscriptStatus): DecisionTone {
  switch (value) {
    case "completed":
      return "accepted";
    case "in_progress":
      return "uncertain";
    case "failed":
      return "rejected";
    case "not_started":
      return "pending";
  }
}

function getReviewTone(value: ReviewStatus): DecisionTone {
  switch (value) {
    case "completed":
      return "accepted";
    case "in_review":
      return "uncertain";
    case "ready":
      return "accepted";
    case "not_started":
      return "pending";
  }
}

function getExportTone(value: ExportStatus): DecisionTone {
  switch (value) {
    case "approved":
    case "sent":
      return "accepted";
    case "draft":
      return "uncertain";
    case "not_requested":
      return "pending";
  }
}

function formatSpeakerLabel(value: TranscriptSpeakerLabel): string {
  switch (value) {
    case "clinician":
      return "Clinician";
    case "patient":
      return "Patient";
    case "caregiver":
      return "Caregiver";
    case "staff":
      return "Staff";
    case "speaker_a":
      return "Speaker A";
    case "speaker_b":
      return "Speaker B";
    case "unknown":
      return "Unknown speaker";
  }
}

function formatConfidence(value: number | undefined): string {
  if (typeof value !== "number") {
    return "N/A";
  }

  return `${Math.round(value * 100)}%`;
}

function formatOffset(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderSegmentText(
  text: string,
  evidenceSpans: EvidenceSpan[]
): React.ReactNode {
  const ranges = evidenceSpans
    .map((span) => resolveHighlightRange(text, span))
    .filter((range): range is { start: number; end: number } => range !== null)
    .sort((left, right) => left.start - right.start);

  if (ranges.length === 0) {
    return text;
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    const start = Math.max(range.start, cursor);
    const end = Math.max(range.end, start);

    if (start > cursor) {
      nodes.push(
        <span key={`plain-${index}-${cursor}`}>{text.slice(cursor, start)}</span>
      );
    }

    nodes.push(
      <mark key={`mark-${index}-${start}`} className="session-review__inline-evidence">
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  });

  if (cursor < text.length) {
    nodes.push(<span key={`tail-${cursor}`}>{text.slice(cursor)}</span>);
  }

  return nodes;
}

function resolveHighlightRange(
  text: string,
  evidenceSpan: EvidenceSpan
): { start: number; end: number } | null {
  if (
    typeof evidenceSpan.startTextOffset === "number" &&
    typeof evidenceSpan.endTextOffset === "number" &&
    evidenceSpan.startTextOffset >= 0 &&
    evidenceSpan.endTextOffset > evidenceSpan.startTextOffset &&
    evidenceSpan.endTextOffset <= text.length
  ) {
    return {
      start: evidenceSpan.startTextOffset,
      end: evidenceSpan.endTextOffset,
    };
  }

  const excerpt = evidenceSpan.excerpt.trim();
  if (!excerpt) {
    return null;
  }

  const start = text.toLowerCase().indexOf(excerpt.toLowerCase());
  if (start === -1) {
    return null;
  }

  return {
    start,
    end: start + excerpt.length,
  };
}

function formatDecisionLabel(
  value: ReviewDecisionOutcome | undefined
): string {
  switch (value) {
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    case "uncertain":
      return "Uncertain";
    case "edited":
      return "Edited";
    default:
      return "Pending review";
  }
}

function getDecisionTone(
  value: ReviewDecisionOutcome | undefined
): DecisionTone {
  switch (value) {
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "uncertain":
    case "edited":
      return "uncertain";
    default:
      return "pending";
  }
}

function formatAssistDisposition(
  value: NonNullable<ModelAssistReceipt["assessment"]>["disposition"]
): string {
  switch (value) {
    case "routine_review":
      return "Routine review";
    case "expedited_human_review":
      return "Expedited human review";
    case "insufficient_context":
      return "Insufficient context";
  }
}

function formatAssistStatus(receipt: ModelAssistReceipt): string {
  if (receipt.status === "failed") {
    return "Remote assist failed";
  }

  const disposition = receipt.assessment?.disposition;
  if (!disposition) {
    return "Remote assist completed";
  }

  return formatAssistDisposition(disposition);
}
