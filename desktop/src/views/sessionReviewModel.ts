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

export interface TranscriptTextSegment {
  text: string;
  highlighted: boolean;
}

export interface HighlightRange {
  start: number;
  end: number;
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

/**
 * Resolve where, if anywhere, an evidence span should be highlighted inside a
 * transcript segment's text. Prefer explicit text offsets when they are present
 * and in-bounds; otherwise fall back to a case-insensitive excerpt match.
 * Returns null when the span cannot be located in the text.
 */
export function resolveHighlightRange(
  text: string,
  evidenceSpan: EvidenceSpan
): HighlightRange | null {
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

/**
 * Split a transcript segment's text into ordered plain and highlighted spans
 * based on its evidence spans. Overlapping, nested, and duplicate evidence
 * spans are merged: a span that ends at or before the running cursor is fully
 * covered by an earlier highlight and is skipped, so the result never contains
 * an empty highlighted span (which would render as a stray empty <mark>).
 */
export function buildTranscriptHighlightSegments(
  text: string,
  evidenceSpans: EvidenceSpan[]
): TranscriptTextSegment[] {
  const ranges = evidenceSpans
    .map((span) => resolveHighlightRange(text, span))
    .filter((range): range is HighlightRange => range !== null)
    .sort((left, right) => left.start - right.start);

  if (ranges.length === 0) {
    return text ? [{ text, highlighted: false }] : [];
  }

  const segments: TranscriptTextSegment[] = [];
  let cursor = 0;

  ranges.forEach((range) => {
    // A range ending at or before the cursor adds no new highlighted
    // characters; emitting it would produce an empty highlighted span.
    if (range.end <= cursor) {
      return;
    }

    const start = Math.max(range.start, cursor);

    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), highlighted: false });
    }

    segments.push({ text: text.slice(start, range.end), highlighted: true });
    cursor = range.end;
  });

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }

  return segments;
}

/**
 * Produce a human-readable excerpt for a selected transcript section. Falls
 * back to the full segment text when no usable evidence excerpts exist, dedupes
 * repeated excerpts, and joins multiple distinct excerpts.
 */
export function formatSelectedSectionExcerpt(
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
