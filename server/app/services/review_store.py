from datetime import datetime, timezone
from uuid import uuid4

from app.api.review_models import (
    ApprovedEvidenceExcerptModel,
    ApprovedExportFindingModel,
    ApprovedExportModel,
    AuditLogEntryModel,
    EvidenceSpanModel,
    FindingModel,
    ReviewDecisionCreateRequest,
    ReviewDecisionModel,
    ReviewSessionModel,
    SessionBundleModel,
    SessionConsentModel,
    TranscriptSegmentModel,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def current_organization_id(token: dict) -> str:
    return str(token.get("org") or token.get("organization_id") or "demo-health")


def _decision_status(outcome: str) -> str:
    return {
        "accepted": "accepted",
        "rejected": "rejected",
        "uncertain": "uncertain",
        "edited": "revised",
    }.get(outcome, "pending_review")


class ReviewStore:
    def __init__(self) -> None:
        self._bundles: dict[str, SessionBundleModel] = {}
        seed = self._seed_bundle()
        self._bundles[seed.session.id] = seed

    def list_sessions(
        self,
        organization_id: str,
        review_status: str | None = None,
        export_status: str | None = None,
        clinician_id: str | None = None,
    ) -> list[ReviewSessionModel]:
        sessions = []
        for bundle in self._bundles.values():
            session = bundle.session
            if session.organizationId != organization_id:
                continue
            if review_status and session.reviewStatus != review_status:
                continue
            if export_status and session.exportStatus != export_status:
                continue
            if clinician_id and session.clinicianId != clinician_id:
                continue
            sessions.append(session.model_copy(deep=True))
        return sorted(sessions, key=lambda item: item.createdAt, reverse=True)

    def get_session_bundle(
        self, organization_id: str, session_id: str
    ) -> SessionBundleModel:
        bundle = self._bundles.get(session_id)
        if bundle is None or bundle.session.organizationId != organization_id:
            raise KeyError(session_id)
        return bundle.model_copy(deep=True)

    def upsert_session_bundle(
        self, organization_id: str, bundle: SessionBundleModel
    ) -> SessionBundleModel:
        session = bundle.session.model_copy(deep=True)
        if session.organizationId not in {None, organization_id}:
            raise ValueError("session organization does not match authenticated organization")

        now = _now_iso()
        session.organizationId = organization_id
        session.updatedAt = now

        stored_bundle = bundle.model_copy(deep=True)
        stored_bundle.session = session
        self._bundles[session.id] = stored_bundle
        return stored_bundle.model_copy(deep=True)

    def list_findings(
        self,
        organization_id: str,
        session_id: str | None = None,
        status: str | None = None,
    ) -> list[FindingModel]:
        findings: list[FindingModel] = []
        for bundle in self._bundles.values():
            if bundle.session.organizationId != organization_id:
                continue
            if session_id and bundle.session.id != session_id:
                continue
            for finding in bundle.findings:
                if status and finding.status != status:
                    continue
                findings.append(finding.model_copy(deep=True))
        return sorted(findings, key=lambda item: item.updatedAt, reverse=True)

    def get_finding(self, organization_id: str, finding_id: str) -> FindingModel:
        for bundle in self._bundles.values():
            if bundle.session.organizationId != organization_id:
                continue
            for finding in bundle.findings:
                if finding.id == finding_id:
                    return finding.model_copy(deep=True)
        raise KeyError(finding_id)

    def create_review_decision(
        self,
        organization_id: str,
        finding_id: str,
        payload: ReviewDecisionCreateRequest,
    ) -> ReviewDecisionModel:
        for bundle in self._bundles.values():
            if bundle.session.organizationId != organization_id:
                continue
            for index, finding in enumerate(bundle.findings):
                if finding.id != finding_id:
                    continue

                reviewed_at = _now_iso()
                decision = ReviewDecisionModel(
                    id=f"decision-{uuid4().hex[:10]}",
                    sessionId=finding.sessionId,
                    findingId=finding_id,
                    outcome=payload.outcome,
                    reviewedBy=payload.reviewedBy,
                    reviewedAt=reviewed_at,
                    rationale=payload.rationale,
                    editedTitle=payload.editedTitle,
                    editedSummary=payload.editedSummary,
                    approvedEvidenceSpans=(
                        payload.approvedEvidenceSpans
                        if payload.approvedEvidenceSpans is not None
                        else finding.evidenceSpans
                    ),
                )

                updated_finding = finding.model_copy(deep=True)
                updated_finding.reviewDecisionId = decision.id
                updated_finding.status = _decision_status(payload.outcome)
                updated_finding.updatedAt = reviewed_at
                if payload.editedTitle:
                    updated_finding.title = payload.editedTitle
                if payload.editedSummary:
                    updated_finding.summary = payload.editedSummary

                bundle.findings[index] = updated_finding
                bundle.reviewDecisions.append(decision)
                bundle.session.reviewStatus = "in_review"
                bundle.session.updatedAt = reviewed_at
                bundle.auditLogEntries.append(
                    AuditLogEntryModel(
                        id=f"audit-{uuid4().hex[:10]}",
                        sessionId=bundle.session.id,
                        timestamp=reviewed_at,
                        action="finding_reviewed",
                        actorId=payload.reviewedBy,
                        details={
                            "findingId": finding_id,
                            "outcome": payload.outcome,
                        },
                    )
                )

                return decision.model_copy(deep=True)

        raise KeyError(finding_id)

    def list_approved_exports(
        self,
        organization_id: str,
        session_id: str | None = None,
        status: str | None = None,
    ) -> list[ApprovedExportModel]:
        exports: list[ApprovedExportModel] = []
        for bundle in self._bundles.values():
            if bundle.session.organizationId != organization_id:
                continue
            if session_id and bundle.session.id != session_id:
                continue
            for export in bundle.approvedExports:
                if status and export.status != status:
                    continue
                exports.append(export.model_copy(deep=True))
        return sorted(exports, key=lambda item: item.approvedAt, reverse=True)

    def get_approved_export(
        self, organization_id: str, export_id: str
    ) -> ApprovedExportModel:
        for bundle in self._bundles.values():
            if bundle.session.organizationId != organization_id:
                continue
            for export in bundle.approvedExports:
                if export.id == export_id:
                    return export.model_copy(deep=True)
        raise KeyError(export_id)

    def ingest_approved_export(
        self, organization_id: str, payload: ApprovedExportModel
    ) -> ApprovedExportModel:
        bundle = self._bundles.get(payload.sessionId)
        if bundle is None or bundle.session.organizationId != organization_id:
            raise KeyError(payload.sessionId)

        export = payload.model_copy(deep=True)
        if not export.id:
            export.id = f"export-{uuid4().hex[:10]}"

        bundle.approvedExports = [
            item for item in bundle.approvedExports if item.id != export.id
        ]
        bundle.approvedExports.append(export)
        bundle.session.exportStatus = export.status
        bundle.session.updatedAt = _now_iso()
        bundle.auditLogEntries.append(
            AuditLogEntryModel(
                id=f"audit-{uuid4().hex[:10]}",
                sessionId=bundle.session.id,
                timestamp=bundle.session.updatedAt,
                action="export_sent" if export.status == "sent" else "export_approved",
                actorId=export.approvedBy,
                details={
                    "exportId": export.id,
                    "status": export.status,
                    "destination": export.destination,
                },
            )
        )
        return export.model_copy(deep=True)

    def _seed_bundle(self) -> SessionBundleModel:
        created_at = "2026-03-15T16:30:00Z"
        updated_at = "2026-03-15T17:15:00Z"
        session_id = "session-demo-001"

        transcript_segments = [
            TranscriptSegmentModel(
                id="segment-001",
                sessionId=session_id,
                speakerLabel="clinician",
                text="Let's talk through how often you've missed your blood pressure medication this week.",
                startOffsetMs=0,
                endOffsetMs=6100,
                transcriptConfidence=0.97,
                speakerConfidence=0.94,
                source="audio_import",
            ),
            TranscriptSegmentModel(
                id="segment-002",
                sessionId=session_id,
                speakerLabel="patient",
                text="I missed it on Tuesday and again yesterday because I ran out before the refill was ready.",
                startOffsetMs=6200,
                endOffsetMs=14300,
                transcriptConfidence=0.95,
                speakerConfidence=0.92,
                source="audio_import",
            ),
            TranscriptSegmentModel(
                id="segment-003",
                sessionId=session_id,
                speakerLabel="clinician",
                text="I'll send the refill today and I'd like you back in one week for a blood pressure check.",
                startOffsetMs=14400,
                endOffsetMs=20900,
                transcriptConfidence=0.96,
                speakerConfidence=0.93,
                source="audio_import",
            ),
        ]

        adherence_evidence = EvidenceSpanModel(
            id="evidence-001",
            transcriptSegmentId="segment-002",
            excerpt="I missed it on Tuesday and again yesterday because I ran out before the refill was ready.",
            startOffsetMs=6200,
            endOffsetMs=14300,
            startTextOffset=0,
            endTextOffset=88,
        )
        follow_up_evidence = EvidenceSpanModel(
            id="evidence-002",
            transcriptSegmentId="segment-003",
            excerpt="I'll send the refill today and I'd like you back in one week for a blood pressure check.",
            startOffsetMs=14400,
            endOffsetMs=20900,
            startTextOffset=0,
            endTextOffset=85,
        )

        findings = [
            FindingModel(
                id="finding-001",
                sessionId=session_id,
                code="medication-adherence",
                title="Medication adherence risk needs reviewer confirmation",
                summary="The patient reported two missed doses after running out of medication before the refill was available.",
                status="pending_review",
                confidence=0.82,
                evidenceSpans=[adherence_evidence],
                detectedBy="rules",
                createdAt=created_at,
                updatedAt=updated_at,
            ),
            FindingModel(
                id="finding-002",
                sessionId=session_id,
                code="follow-up-plan",
                title="Follow-up plan was clearly documented",
                summary="The clinician confirmed a refill plan and a blood pressure check in one week.",
                status="accepted",
                confidence=0.76,
                evidenceSpans=[follow_up_evidence],
                detectedBy="human",
                createdAt=created_at,
                updatedAt=updated_at,
                reviewDecisionId="decision-001",
            ),
        ]

        review_decisions = [
            ReviewDecisionModel(
                id="decision-001",
                sessionId=session_id,
                findingId="finding-002",
                outcome="accepted",
                reviewedBy="reviewer-7",
                reviewedAt=updated_at,
                rationale="Evidence supports including the documented follow-up plan in the approved export.",
                approvedEvidenceSpans=[],
            )
        ]

        approved_exports = [
            ApprovedExportModel(
                id="export-001",
                sessionId=session_id,
                status="draft",
                summary="Draft review export covering medication adherence follow-up and refill planning.",
                findings=[
                    ApprovedExportFindingModel(
                        findingId="finding-002",
                        code="follow-up-plan",
                        title="Follow-up plan was clearly documented",
                        summary="The clinician scheduled a refill follow-up and blood pressure check.",
                        reviewDecisionId="decision-001",
                        evidenceExcerpts=[
                            ApprovedEvidenceExcerptModel(
                                sourceEvidenceSpanId="evidence-002",
                                sourceTranscriptSegmentId="segment-003",
                                excerpt="I'll send the refill today and I'd like you back in one week for a blood pressure check.",
                                startOffsetMs=14400,
                                endOffsetMs=20900,
                            )
                        ],
                    )
                ],
                approvedBy="quality-lead-2",
                approvedAt=updated_at,
                destination="qa-review-queue",
            )
        ]

        audit_entries = [
            AuditLogEntryModel(
                id="audit-001",
                sessionId=session_id,
                timestamp=created_at,
                action="session_created",
                actorId="desktop-import",
                details={"captureMode": "audio_import"},
            ),
            AuditLogEntryModel(
                id="audit-002",
                sessionId=session_id,
                timestamp=updated_at,
                action="finding_reviewed",
                actorId="reviewer-7",
                details={"findingId": "finding-002", "outcome": "accepted"},
            ),
        ]

        return SessionBundleModel(
            session=ReviewSessionModel(
                id=session_id,
                clinicianId="clinician-017",
                organizationId="demo-health",
                encounterStartedAt=created_at,
                encounterEndedAt="2026-03-15T17:02:00Z",
                captureMode="audio_import",
                transcriptStatus="completed",
                reviewStatus="in_review",
                exportStatus="draft",
                createdAt=created_at,
                updatedAt=updated_at,
                consent=SessionConsentModel(
                    recordedWithConsent=True,
                    exportAllowed=True,
                    capturedAt=created_at,
                    capturedBy="desktop-import",
                ),
            ),
            transcriptSegments=transcript_segments,
            findings=findings,
            reviewDecisions=review_decisions,
            approvedExports=approved_exports,
            auditLogEntries=audit_entries,
        )


review_store = ReviewStore()
