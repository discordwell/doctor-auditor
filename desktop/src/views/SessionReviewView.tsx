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
  countSelectedTranscriptSections,
  getApprovedEvidenceSpans,
  getApprovedExportActionState,
  hasApprovedEvidenceSelectionChanges,
  getPersistedOutcome,
  toggleTranscriptSegmentSelection,
} from "./sessionReviewModel";
import "./SessionReviewView.css";

type LoadState = "loading" | "ready" | "error";
type DecisionTone = "accepted" | "rejected" | "uncertain" | "pending";
const SESSION_ASSIST_TARGET = "__session__";

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
  const [approvedEvidenceDrafts, setApprovedEvidenceDrafts] = useState<
    Record<string, EvidenceSpan[]>
  >({});
  const [savingFindingId, setSavingFindingId] = useState<string | null>(null);
  const [requestingAssistTarget, setRequestingAssistTarget] = useState<
    string | null
  >(null);
  const [isCreatingExport, setIsCreatingExport] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    let requestSequence = 0;

    async function loadSession(
      mode: "initial" | "refresh" = "initial"
    ): Promise<void> {
      const requestId = requestSequence + 1;
      requestSequence = requestId;

      if (!window.doctorAuditor) {
        setLoadState("error");
        setErrorMessage("Desktop session API unavailable.");
        return;
      }

      if (mode === "initial") {
        setLoadState("loading");
        setErrorMessage("");
        setActionErrorMessage("");
        setActionInfoMessage("");
      }

      try {
        const nextBundle = await window.doctorAuditor.session.get(sessionId);

        if (isCancelled || requestId !== requestSequence) {
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
        if (isCancelled || requestId !== requestSequence) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Unable to load the selected review session.";

        if (mode === "initial") {
          setLoadState("error");
          setErrorMessage(message);
          return;
        }

        setActionErrorMessage(
          `Unable to refresh the latest session state: ${message}`
        );
      }
    }

    void loadSession();

    if (!window.doctorAuditor) {
      return () => {
        isCancelled = true;
      };
    }

    const unsubscribe = window.doctorAuditor.session.onSessionChanged(
      (sessionSummary) => {
        if (sessionSummary.session.id !== sessionId) {
          return;
        }

        void loadSession("refresh");
      }
    );

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!bundle) {
      setApprovedEvidenceDrafts({});
      return;
    }

    const workspace = buildReviewWorkspace(bundle);
    const findingIds = new Set(workspace.findings.map((finding) => finding.id));

    setApprovedEvidenceDrafts((currentDrafts) => {
      const nextDrafts = Object.fromEntries(
        Object.entries(currentDrafts).filter(([findingId]) => findingIds.has(findingId))
      );

      return Object.keys(nextDrafts).length === Object.keys(currentDrafts).length
        ? currentDrafts
        : nextDrafts;
    });

    setSelectedFindingId((current) => {
      if (current && workspace.findings.some((finding) => finding.id === current)) {
        return current;
      }

      return workspace.findings[0]?.id ?? null;
    });
  }, [bundle]);

  async function saveReviewDecision(
    findingId: string,
    outcome: ReviewDecisionOutcome,
    approvedEvidenceSpans?: EvidenceSpan[],
    successMessage?: string
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
        approvedEvidenceSpans,
      });

      if (!nextBundle) {
        throw new Error("The selected finding could not be saved.");
      }

      setApprovedEvidenceDrafts((currentDrafts) => {
        if (!(findingId in currentDrafts)) {
          return currentDrafts;
        }

        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[findingId];
        return nextDrafts;
      });
      setBundle(nextBundle);
      if (successMessage) {
        setActionInfoMessage(successMessage);
      }
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

  async function requestSeriousnessAssist(findingId?: string): Promise<void> {
    if (!window.doctorAuditor || !bundle) {
      setActionErrorMessage("Desktop review persistence is unavailable.");
      return;
    }

    const requestTarget = findingId ?? SESSION_ASSIST_TARGET;

    setActionErrorMessage("");
    setActionInfoMessage("");
    setRequestingAssistTarget(requestTarget);

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
      setRequestingAssistTarget((currentTarget) =>
        currentTarget === requestTarget ? null : currentTarget
      );
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
      const result = await window.doctorAuditor.session.updateModelAssistAction({
        sessionId: bundle.session.id,
        receiptId,
        reviewerAction: "dismissed",
      });

      setBundle(result.bundle);
      setActionInfoMessage(
        result.syncError
          ? `Remote assist recommendation dismissed locally, but cloud ops sync failed: ${result.syncError}`
          : "Remote assist recommendation dismissed locally."
      );
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

    if (
      bundle.session.exportStatus === "approved" ||
      bundle.session.exportStatus === "sent"
    ) {
      setActionErrorMessage("");
      setActionInfoMessage("This session already has an approved export envelope.");
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
  const approvedExportAction = bundle
    ? getApprovedExportActionState(bundle.session, isCreatingExport)
    : null;
  const findings = workspace?.findings ?? [];
  const transcriptSegments = workspace?.transcriptSegments ?? [];
  const modelAssistReceipts = bundle?.modelAssistReceipts ?? [];
  const selectedFinding =
    findings.find((finding) => finding.id === selectedFindingId) ?? findings[0];
  const persistedApprovedEvidenceSpans =
    selectedFinding && bundle
      ? getApprovedEvidenceSpans(selectedFinding, bundle.reviewDecisions)
      : [];
  const selectedEvidenceSpans = selectedFinding
    ? approvedEvidenceDrafts[selectedFinding.id] ?? persistedApprovedEvidenceSpans
    : [];
  const selectedTranscriptSectionCount =
    countSelectedTranscriptSections(selectedEvidenceSpans);
  const suggestedTranscriptSectionCount = selectedFinding
    ? countSelectedTranscriptSections(selectedFinding.evidenceSpans)
    : 0;
  const hasUnsavedEvidenceSelectionChanges =
    selectedFinding && bundle
      ? hasApprovedEvidenceSelectionChanges(
          selectedEvidenceSpans,
          persistedApprovedEvidenceSpans
        )
      : false;
  const selectedTranscriptSections = selectedFinding
    ? transcriptSegments.flatMap((segment) => {
        const sectionEvidenceSpans = selectedEvidenceSpans.filter(
          (span) => span.transcriptSegmentId === segment.id
        );

        if (sectionEvidenceSpans.length === 0) {
          return [];
        }

        return [
          {
            segment,
            evidenceSpans: sectionEvidenceSpans,
            ruleEvidenceSpans: selectedFinding.evidenceSpans.filter(
              (span) => span.transcriptSegmentId === segment.id
            ),
          },
        ];
      })
    : [];
  const selectedOutcome =
    selectedFinding && bundle
      ? getPersistedOutcome(selectedFinding, bundle.reviewDecisions)
      : undefined;
  const selectedAssistReceipts = modelAssistReceipts
    .filter((receipt) =>
      selectedFinding
        ? receipt.findingId === selectedFinding.id
        : receipt.findingId === undefined
    )
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  const latestAssistReceipt = selectedAssistReceipts[0];
  const reviewedCount = findings.filter((finding) =>
    Boolean(bundle && getPersistedOutcome(finding, bundle.reviewDecisions))
  ).length;
  const findingsQueueSummary = bundle
    ? buildFindingQueueSummary(bundle, findings)
    : [];
  const isSavingSelectedDecision =
    selectedFinding !== undefined && savingFindingId === selectedFinding.id;
  const isRequestingSelectedAssist = selectedFinding
    ? requestingAssistTarget === selectedFinding.id
    : requestingAssistTarget === SESSION_ASSIST_TARGET;
  const isRequestingAnyAssist = requestingAssistTarget !== null;

  function jumpToTranscriptSegment(segmentId: string): void {
    const element = document.getElementById(getTranscriptSegmentElementId(segmentId));
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function updateApprovedEvidenceDraft(
    finding: Finding,
    nextApprovedEvidenceSpans: EvidenceSpan[]
  ): void {
    if (!bundle) {
      return;
    }

    const persistedSelection = getApprovedEvidenceSpans(
      finding,
      bundle.reviewDecisions
    );
    const hasChanges = hasApprovedEvidenceSelectionChanges(
      nextApprovedEvidenceSpans,
      persistedSelection
    );

    setApprovedEvidenceDrafts((currentDrafts) => {
      if (!hasChanges) {
        if (!(finding.id in currentDrafts)) {
          return currentDrafts;
        }

        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[finding.id];
        return nextDrafts;
      }

      return {
        ...currentDrafts,
        [finding.id]: nextApprovedEvidenceSpans,
      };
    });
  }

  function toggleApprovedTranscriptSection(segment: TranscriptSegment): void {
    if (!selectedFinding) {
      return;
    }

    updateApprovedEvidenceDraft(
      selectedFinding,
      toggleTranscriptSegmentSelection(
        selectedFinding,
        segment,
        selectedEvidenceSpans
      )
    );
  }

  function restoreRuleSuggestedSections(): void {
    if (!selectedFinding) {
      return;
    }

    updateApprovedEvidenceDraft(selectedFinding, selectedFinding.evidenceSpans);
  }

  function revertApprovedEvidenceDraft(): void {
    if (!selectedFinding) {
      return;
    }

    updateApprovedEvidenceDraft(selectedFinding, persistedApprovedEvidenceSpans);
  }

  async function saveApprovedEvidenceSelection(): Promise<void> {
    if (!selectedFinding) {
      return;
    }

    if (!selectedOutcome) {
      setActionErrorMessage(
        "Choose a review outcome before saving selected transcript sections."
      );
      setActionInfoMessage("");
      return;
    }

    await saveReviewDecision(
      selectedFinding.id,
      selectedOutcome,
      selectedEvidenceSpans,
      "Transcript section selection saved locally."
    );
  }

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

  const noFindingsMessage = getNoFindingsMessage(bundle);
  const findingsSummaryCaption = getFindingsSummaryCaption(bundle, workspace);
  const transcriptPanelNote = selectedFinding
    ? buildTranscriptPanelNote({
        hasUnsavedEvidenceSelectionChanges,
        selectedTranscriptSectionCount,
        suggestedTranscriptSectionCount,
      })
    : workspace.hasFindings
      ? "Select a finding to review and adjust transcript sections."
      : "No findings are available for evidence highlighting.";

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
          className="session-review__button session-review__button--secondary"
          onClick={() => void requestSeriousnessAssist(selectedFinding?.id)}
          disabled={isRequestingAnyAssist}
        >
          {isRequestingAnyAssist
            ? "Requesting..."
            : selectedFinding
              ? "Request Remote assist"
              : "Request Remote assist for session"}
        </button>
        <button
          type="button"
          className="session-review__button"
          onClick={() => void createApprovedExport()}
          disabled={approvedExportAction?.disabled ?? true}
        >
          {approvedExportAction?.label ?? "Approve export envelope"}
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
          <p className="session-review__summary-caption">{findingsSummaryCaption}</p>
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
          {noFindingsMessage}
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
        <section className="session-review__panel session-review__panel--transcript">
          <div className="session-review__panel-header">
            <div>
              <p className="session-review__panel-kicker">Transcript</p>
              <h3>Evidence timeline</h3>
            </div>
            <p className="session-review__panel-note">{transcriptPanelNote}</p>
          </div>

          <div className="session-review__transcript-list">
            {transcriptSegments.length > 0 ? (
              transcriptSegments.map((segment) => {
                const selectedSectionEvidence = selectedFinding
                  ? selectedEvidenceSpans.filter(
                      (span) => span.transcriptSegmentId === segment.id
                    )
                  : [];
                const suggestedEvidence = selectedFinding
                  ? selectedFinding.evidenceSpans.filter(
                      (span) => span.transcriptSegmentId === segment.id
                    )
                  : [];
                const isSelectedSection = selectedSectionEvidence.length > 0;
                const isSuggestedSection = suggestedEvidence.length > 0;
                const isManualSelection =
                  isSelectedSection && suggestedEvidence.length === 0;

                return (
                  <article
                    key={segment.id}
                    id={getTranscriptSegmentElementId(segment.id)}
                    className={`session-review__segment ${
                      isSelectedSection ? "is-highlighted" : ""
                    } ${
                      !isSelectedSection && isSuggestedSection ? "is-suggested" : ""
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
                      <div className="session-review__segment-tools">
                        <div className="session-review__confidence">
                          <span>
                            Transcript {formatConfidence(segment.transcriptConfidence)}
                          </span>
                          <span>
                            Speaker {formatConfidence(segment.speakerConfidence)}
                          </span>
                        </div>
                        {selectedFinding ? (
                          <button
                            type="button"
                            className={`session-review__segment-toggle ${
                              isSelectedSection ? "is-active" : ""
                            }`}
                            onClick={() => toggleApprovedTranscriptSection(segment)}
                          >
                            {isSelectedSection
                              ? "Remove section"
                              : isSuggestedSection
                                ? "Restore suggestion"
                                : "Add section"}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <p className="session-review__segment-text">
                      {renderSegmentText(segment.text, selectedSectionEvidence)}
                    </p>

                    {(isSelectedSection || isSuggestedSection) && (
                      <div className="session-review__evidence-row">
                        {isSelectedSection ? (
                          <span className="session-review__evidence-chip session-review__evidence-chip--selected">
                            Selected for review
                          </span>
                        ) : null}
                        {isSuggestedSection ? (
                          <span className="session-review__evidence-chip">
                            Rule suggestion
                          </span>
                        ) : null}
                        {isManualSelection ? (
                          <span className="session-review__evidence-chip session-review__evidence-chip--manual">
                            Manual section
                          </span>
                        ) : null}
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

        <section className="session-review__panel session-review__panel--queue">
          <div className="session-review__panel-header">
            <div>
              <p className="session-review__panel-kicker">Findings</p>
              <h3>Reviewer queue</h3>
            </div>
            <p className="session-review__panel-note">
              Pick a finding from the queue, then review its evidence and actions
              in the detail panel.
            </p>
          </div>

          <div className="session-review__queue-summary">
            {findingsQueueSummary.map((summaryCard) => (
              <article
                key={summaryCard.label}
                className={`session-review__queue-card session-review__queue-card--${summaryCard.tone}`}
              >
                <p className="session-review__queue-card-label">
                  {summaryCard.label}
                </p>
                <p className="session-review__queue-card-value">
                  {summaryCard.value}
                </p>
                <p className="session-review__queue-card-caption">
                  {summaryCard.caption}
                </p>
              </article>
            ))}
          </div>

          <div className="session-review__findings-list">
            {findings.length > 0 ? (
              findings.map((finding) => {
                const appliedOutcome = getPersistedOutcome(
                  finding,
                  bundle.reviewDecisions
                );
                const tone = getDecisionTone(appliedOutcome);
                const isSelected = selectedFinding?.id === finding.id;

                return (
                  <button
                    key={finding.id}
                    type="button"
                    className={`session-review__finding ${
                      isSelected ? "is-selected" : ""
                    }`}
                    onClick={() => setSelectedFindingId(finding.id)}
                    aria-pressed={isSelected}
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
                      <span className="session-review__meta-pill">
                        {Math.round(finding.confidence * 100)}% confidence
                      </span>
                      <span className="session-review__meta-pill">
                        {finding.detectedBy}
                      </span>
                      <span className="session-review__meta-pill">
                        {finding.evidenceSpans.length} span(s)
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="session-review__empty-detail">
                Findings have not been saved for this session yet.
              </div>
            )}
          </div>
        </section>

        <section className="session-review__panel session-review__panel--detail">
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
              <div className="session-review__detail-hero">
                <div className="session-review__detail-hero-top">
                  <p className="session-review__finding-code">
                    {selectedFinding.code}
                  </p>
                  <strong
                    className={`session-review__detail-value session-review__detail-value--${getDecisionTone(
                      selectedOutcome
                    )}`}
                  >
                    {formatDecisionLabel(selectedOutcome)}
                  </strong>
                </div>
                <p className="session-review__detail-summary">
                  {selectedFinding.summary}
                </p>
                <div className="session-review__finding-meta">
                  <span className="session-review__meta-pill">
                    {Math.round(selectedFinding.confidence * 100)}% confidence
                  </span>
                  <span className="session-review__meta-pill">
                    {selectedFinding.detectedBy}
                  </span>
                  <span className="session-review__meta-pill">
                    {selectedTranscriptSectionCount} selected section(s)
                  </span>
                  <span className="session-review__meta-pill">
                    {suggestedTranscriptSectionCount} rule section(s)
                  </span>
                </div>
              </div>

              <div className="session-review__actions session-review__actions--detail">
                {(
                  [
                    ["accepted", "Accept", "accepted"],
                    ["uncertain", "Needs follow-up", "uncertain"],
                    ["rejected", "Reject", "rejected"],
                  ] as Array<
                    [ReviewDecisionOutcome, string, Exclude<DecisionTone, "pending">]
                  >
                ).map(([outcome, label, tone]) => (
                  <button
                    key={outcome}
                    type="button"
                    className={`session-review__action-button session-review__action-button--${tone} ${
                      selectedOutcome === outcome ? "is-active" : ""
                    }`}
                    onClick={() =>
                      void saveReviewDecision(
                        selectedFinding.id,
                        outcome,
                        selectedEvidenceSpans
                      )
                    }
                    disabled={isSavingSelectedDecision}
                  >
                    {isSavingSelectedDecision ? "Saving..." : label}
                  </button>
                ))}
                <button
                  type="button"
                  className="session-review__action-button session-review__action-button--assist"
                  onClick={() =>
                    void requestSeriousnessAssist(selectedFinding.id)
                  }
                  disabled={isRequestingAnyAssist}
                >
                  {isRequestingSelectedAssist
                    ? "Requesting..."
                    : "Request Remote assist"}
                </button>
                {(selectedTranscriptSections.length > 0 ||
                  selectedFinding.evidenceSpans.length > 0) && (
                  <button
                    type="button"
                    className="session-review__action-button session-review__action-button--ghost"
                    onClick={() =>
                      jumpToTranscriptSegment(
                        selectedTranscriptSections[0]?.segment.id ??
                          selectedFinding.evidenceSpans[0].transcriptSegmentId
                      )
                    }
                  >
                    Jump to first selected section
                  </button>
                )}
                <button
                  type="button"
                  className="session-review__action-button session-review__action-button--ghost"
                  onClick={() => void saveApprovedEvidenceSelection()}
                  disabled={!selectedOutcome || !hasUnsavedEvidenceSelectionChanges}
                >
                  Save selected sections
                </button>
                <button
                  type="button"
                  className="session-review__action-button session-review__action-button--ghost"
                  onClick={revertApprovedEvidenceDraft}
                  disabled={!hasUnsavedEvidenceSelectionChanges}
                >
                  Revert changes
                </button>
                <button
                  type="button"
                  className="session-review__action-button session-review__action-button--ghost"
                  onClick={restoreRuleSuggestedSections}
                  disabled={selectedFinding.evidenceSpans.length === 0}
                >
                  Use rule suggestions
                </button>
              </div>

              <div className="session-review__detail-stats">
                <article className="session-review__detail-stat">
                  <p className="session-review__detail-stat-label">Updated</p>
                  <p className="session-review__detail-stat-value">
                    {formatDateTime(selectedFinding.updatedAt)}
                  </p>
                </article>
                <article className="session-review__detail-stat">
                  <p className="session-review__detail-stat-label">Detected by</p>
                  <p className="session-review__detail-stat-value">
                    {selectedFinding.detectedBy}
                  </p>
                </article>
                <article className="session-review__detail-stat">
                  <p className="session-review__detail-stat-label">Evidence</p>
                  <p className="session-review__detail-stat-value">
                    {selectedTranscriptSectionCount} section(s) selected
                  </p>
                </article>
                <article className="session-review__detail-stat">
                  <p className="session-review__detail-stat-label">
                    Remote assist
                  </p>
                  <p className="session-review__detail-stat-value">
                    {latestAssistReceipt
                      ? formatAssistStatus(latestAssistReceipt)
                      : "Available on demand"}
                  </p>
                </article>
              </div>

              <div className="session-review__detail-block">
                <div className="session-review__detail-row">
                  <p className="session-review__detail-label">
                    Selected transcript sections
                  </p>
                  <p className="session-review__detail-note">
                    Toggle sections in the transcript panel, then save the finding
                    to persist changes.
                  </p>
                </div>
                <div className="session-review__evidence-list">
                  {selectedTranscriptSections.length > 0 ? (
                    selectedTranscriptSections.map((section) => (
                      <article
                        key={section.segment.id}
                        className="session-review__evidence-card"
                      >
                        <div className="session-review__evidence-card-top">
                          <div>
                            <p className="session-review__evidence-label">
                              {formatSpeakerLabel(section.segment.speakerLabel)} /{" "}
                              {formatOffset(section.segment.startOffsetMs)} -{" "}
                              {formatOffset(section.segment.endOffsetMs)}
                            </p>
                            <div className="session-review__finding-meta">
                              <span className="session-review__meta-pill">
                                {section.ruleEvidenceSpans.length > 0
                                  ? "Rule suggestion"
                                  : "Manual selection"}
                              </span>
                              <span className="session-review__meta-pill">
                                {section.evidenceSpans.length} excerpt(s)
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="session-review__jump-button"
                            onClick={() => jumpToTranscriptSegment(section.segment.id)}
                          >
                            View in transcript
                          </button>
                        </div>
                        <p>
                          {formatSelectedSectionExcerpt(
                            section.segment,
                            section.evidenceSpans
                          )}
                        </p>
                        <button
                          type="button"
                          className="session-review__action-button session-review__action-button--ghost"
                          onClick={() =>
                            toggleApprovedTranscriptSection(section.segment)
                          }
                        >
                          Remove section
                        </button>
                      </article>
                    ))
                  ) : (
                    <div className="session-review__empty-detail">
                      No transcript sections are selected for this finding yet.
                    </div>
                  )}
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
                          className="session-review__action-button session-review__action-button--ghost"
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
                  <div className="session-review__empty-detail">
                    Request Remote assist to log a minimized result using the
                    current finding without moving transcript or findings into
                    the cloud.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="session-review__empty-detail">
              <p>
                No finding is selected for this session. Remote assist can still
                run on minimized session metadata only.
              </p>
              <button
                type="button"
                className="session-review__action-button session-review__action-button--assist"
                onClick={() => void requestSeriousnessAssist()}
                disabled={isRequestingAnyAssist}
              >
                {isRequestingSelectedAssist
                  ? "Requesting..."
                  : "Request Remote assist for session"}
              </button>
              {latestAssistReceipt ? (
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
                </article>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function buildTranscriptPanelNote(input: {
  hasUnsavedEvidenceSelectionChanges: boolean;
  selectedTranscriptSectionCount: number;
  suggestedTranscriptSectionCount: number;
}): string {
  const { hasUnsavedEvidenceSelectionChanges } = input;

  if (input.selectedTranscriptSectionCount === 0) {
    return hasUnsavedEvidenceSelectionChanges
      ? "No transcript sections are currently selected. Unsaved selection changes are pending."
      : "No transcript sections are currently selected for this finding.";
  }

  const baseNote =
    `${input.selectedTranscriptSectionCount} transcript section(s) selected` +
    (input.suggestedTranscriptSectionCount > 0
      ? ` / ${input.suggestedTranscriptSectionCount} suggested by rules.`
      : ".");

  return hasUnsavedEvidenceSelectionChanges
    ? `${baseNote} Unsaved selection changes are pending.`
    : baseNote;
}

function formatSelectedSectionExcerpt(
  segment: TranscriptSegment,
  evidenceSpans: EvidenceSpan[]
): string {
  const excerpts = Array.from(
    new Set(
      evidenceSpans
        .map((span) => span.excerpt.trim())
        .filter((excerpt) => excerpt.length > 0)
    )
  );

  if (excerpts.length === 0) {
    return segment.text;
  }

  if (excerpts.length === 1) {
    return excerpts[0] ?? segment.text;
  }

  return excerpts.join(" / ");
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

function getFindingsSummaryCaption(
  bundle: DesktopSessionBundle,
  workspace: ReturnType<typeof buildReviewWorkspace>
): string {
  if (workspace.hasFindings) {
    return "Persisted findings returned with the local session bundle.";
  }

  if (
    bundle.session.transcriptStatus === "completed" &&
    bundle.session.reviewStatus === "completed"
  ) {
    return "Local analysis completed without generating persisted findings.";
  }

  return "No persisted findings are attached to this session yet.";
}

function getNoFindingsMessage(bundle: DesktopSessionBundle): string {
  if (
    bundle.session.transcriptStatus === "completed" &&
    bundle.session.reviewStatus === "completed"
  ) {
    return (
      "Local analysis completed without generating findings for this session. " +
      "The live review state is up to date."
    );
  }

  return (
    "No persisted findings are attached to this session yet. Reviewer actions " +
    "stay unavailable until findings are saved."
  );
}

function buildFindingQueueSummary(
  bundle: DesktopSessionBundle,
  findings: Finding[]
): Array<{
  caption: string;
  label: string;
  tone: DecisionTone;
  value: number;
}> {
  const counts: Record<DecisionTone, number> = {
    accepted: 0,
    rejected: 0,
    uncertain: 0,
    pending: 0,
  };

  findings.forEach((finding) => {
    const outcome = getPersistedOutcome(finding, bundle.reviewDecisions);
    counts[getDecisionTone(outcome)] += 1;
  });

  return [
    {
      label: "Pending",
      value: counts.pending,
      tone: "pending",
      caption: "Needs a reviewer decision.",
    },
    {
      label: "Accepted",
      value: counts.accepted,
      tone: "accepted",
      caption: "Ready for approved export.",
    },
    {
      label: "Follow-up",
      value: counts.uncertain,
      tone: "uncertain",
      caption: "Marked uncertain or edited.",
    },
    {
      label: "Rejected",
      value: counts.rejected,
      tone: "rejected",
      caption: "Held back from export.",
    },
  ];
}

function getTranscriptSegmentElementId(segmentId: string): string {
  return `session-review-transcript-segment-${segmentId}`;
}
