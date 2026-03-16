import * as path from "path";
import type { DesktopSessionSummary } from "./review-models";

export function canAutoRecoverTranscription(
  sessionSummary: DesktopSessionSummary,
  userDataPath: string
): boolean {
  if (
    !sessionSummary.audioPath ||
    sessionSummary.transcriptSegmentCount > 0 ||
    !sessionSummary.session.encounterEndedAt
  ) {
    return false;
  }

  if (
    sessionSummary.session.captureMode === "manual_entry" ||
    (sessionSummary.session.transcriptStatus !== "not_started" &&
      sessionSummary.session.transcriptStatus !== "in_progress")
  ) {
    return false;
  }

  return isManagedSessionAudioPath(sessionSummary.audioPath, userDataPath);
}

export function canManuallyRetryTranscription(
  sessionSummary: DesktopSessionSummary
): boolean {
  return (
    Boolean(sessionSummary.audioPath) &&
    sessionSummary.transcriptSegmentCount === 0 &&
    sessionSummary.session.captureMode !== "manual_entry" &&
    sessionSummary.session.transcriptStatus === "failed"
  );
}

export function isManagedSessionAudioPath(
  audioPath: string,
  userDataPath: string
): boolean {
  return (
    isWithinDirectory(audioPath, path.join(userDataPath, "imports")) ||
    isWithinDirectory(audioPath, path.join(userDataPath, "sessions"))
  );
}

function isWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}
