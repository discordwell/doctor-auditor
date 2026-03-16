import type {
  ExportStatus,
  Finding,
  ReviewDecision,
  ReviewDecisionOutcome,
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
  if (finding.reviewDecisionId) {
    const matchingDecision = reviewDecisions.find(
      (decision) => decision.id === finding.reviewDecisionId
    );

    if (matchingDecision) {
      return matchingDecision.outcome;
    }
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
