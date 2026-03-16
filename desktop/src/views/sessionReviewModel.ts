import type {
  EvidenceSpan,
  ExportStatus,
  Finding,
  ReviewDecision,
  ReviewDecisionOutcome,
  TranscriptSegment,
} from "@doctor-auditor/shared/local-review";
import type { DesktopSessionBundle } from "../types/electron";

export interface ReviewWorkspace {
  transcriptSegments: DesktopSessionBundle["transcriptSegments"];
  findings: Finding[];
  hasTranscript: boolean;
  hasFindings: boolean;
}

export interface ApprovedExportActionState {
  disabled: boolean;
  label: string;
}

export function buildReviewWorkspace(
  bundle: DesktopSessionBundle
): ReviewWorkspace {
  return {
    transcriptSegments: bundle.transcriptSegments,
    findings: bundle.findings,
    hasTranscript: bundle.transcriptSegments.length > 0,
    hasFindings: bundle.findings.length > 0,
  };
}

export function getPersistedOutcome(
  finding: Finding,
  reviewDecisions: ReviewDecision[]
): ReviewDecisionOutcome | undefined {
  const matchingDecision = findReviewDecision(finding, reviewDecisions);

  if (matchingDecision) {
    return matchingDecision.outcome;
  }

  switch (finding.status) {
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "uncertain":
      return "uncertain";
    default:
      return undefined;
  }
}

export function getApprovedEvidenceSpans(
  finding: Finding,
  reviewDecisions: ReviewDecision[]
): EvidenceSpan[] {
  const matchingDecision = findReviewDecision(finding, reviewDecisions);
  return matchingDecision?.approvedEvidenceSpans ?? finding.evidenceSpans;
}

export function toggleTranscriptSegmentSelection(
  finding: Finding,
  transcriptSegment: TranscriptSegment,
  approvedEvidenceSpans: EvidenceSpan[]
): EvidenceSpan[] {
  if (
    approvedEvidenceSpans.some(
      (span) => span.transcriptSegmentId === transcriptSegment.id
    )
  ) {
    return approvedEvidenceSpans.filter(
      (span) => span.transcriptSegmentId !== transcriptSegment.id
    );
  }

  const suggestedEvidenceSpans = finding.evidenceSpans.filter(
    (span) => span.transcriptSegmentId === transcriptSegment.id
  );

  if (suggestedEvidenceSpans.length > 0) {
    return mergeEvidenceSpans(approvedEvidenceSpans, suggestedEvidenceSpans);
  }

  return mergeEvidenceSpans(approvedEvidenceSpans, [
    createManualEvidenceSpan(finding.id, transcriptSegment),
  ]);
}

export function hasApprovedEvidenceSelectionChanges(
  approvedEvidenceSpans: EvidenceSpan[],
  persistedApprovedEvidenceSpans: EvidenceSpan[]
): boolean {
  const currentKeys = approvedEvidenceSpans
    .map(getEvidenceSpanKey)
    .sort(compareKeys);
  const persistedKeys = persistedApprovedEvidenceSpans
    .map(getEvidenceSpanKey)
    .sort(compareKeys);

  if (currentKeys.length !== persistedKeys.length) {
    return true;
  }

  return currentKeys.some((key, index) => key !== persistedKeys[index]);
}

export function countSelectedTranscriptSections(
  approvedEvidenceSpans: EvidenceSpan[]
): number {
  return new Set(
    approvedEvidenceSpans.map((span) => span.transcriptSegmentId)
  ).size;
}

export function getApprovedExportActionState(
  session: DesktopSessionBundle["session"],
  isCreatingExport: boolean
): ApprovedExportActionState {
  if (isCreatingExport) {
    return {
      disabled: true,
      label: "Saving export...",
    };
  }

  switch (session.exportStatus) {
    case "approved":
      return {
        disabled: true,
        label: "Export envelope approved",
      };
    case "sent":
      return {
        disabled: true,
        label: "Export envelope sent",
      };
    default:
      return {
        disabled:
          !canCreateApprovedExport(session.exportStatus) ||
          session.reviewStatus !== "completed" ||
          !session.consent.exportAllowed,
        label: "Approve export envelope",
      };
  }
}

function canCreateApprovedExport(exportStatus: ExportStatus): boolean {
  return exportStatus === "not_requested" || exportStatus === "draft";
}

function findReviewDecision(
  finding: Finding,
  reviewDecisions: ReviewDecision[]
): ReviewDecision | undefined {
  if (finding.reviewDecisionId) {
    return reviewDecisions.find((decision) => decision.id === finding.reviewDecisionId);
  }

  return reviewDecisions.find((decision) => decision.findingId === finding.id);
}

function createManualEvidenceSpan(
  findingId: string,
  transcriptSegment: TranscriptSegment
): EvidenceSpan {
  return {
    id: `manual-${findingId}-${transcriptSegment.id}`,
    transcriptSegmentId: transcriptSegment.id,
    excerpt: transcriptSegment.text,
    startOffsetMs: transcriptSegment.startOffsetMs,
    endOffsetMs: transcriptSegment.endOffsetMs,
    startTextOffset: 0,
    endTextOffset: transcriptSegment.text.length,
  };
}

function mergeEvidenceSpans(
  currentEvidenceSpans: EvidenceSpan[],
  nextEvidenceSpans: EvidenceSpan[]
): EvidenceSpan[] {
  const existingKeys = new Set(currentEvidenceSpans.map(getEvidenceSpanKey));
  const mergedEvidenceSpans = [...currentEvidenceSpans];

  nextEvidenceSpans.forEach((span) => {
    const spanKey = getEvidenceSpanKey(span);
    if (!existingKeys.has(spanKey)) {
      existingKeys.add(spanKey);
      mergedEvidenceSpans.push(span);
    }
  });

  return mergedEvidenceSpans;
}

function getEvidenceSpanKey(span: EvidenceSpan): string {
  return [
    span.id,
    span.transcriptSegmentId,
    span.startOffsetMs,
    span.endOffsetMs,
    span.startTextOffset ?? "",
    span.endTextOffset ?? "",
    span.excerpt,
  ].join("|");
}

function compareKeys(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
