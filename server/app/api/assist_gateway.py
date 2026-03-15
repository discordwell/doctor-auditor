from datetime import datetime, timezone

from fastapi import APIRouter

from app.api.cloud_models import AssistGatewayRequestModel, SeriousnessAssessmentModel

router = APIRouter()


@router.post(
    "/seriousness-assessments",
    response_model=SeriousnessAssessmentModel,
)
async def create_seriousness_assessment(
    payload: AssistGatewayRequestModel,
):
    disposition = "routine_review"
    confidence = 0.41
    rationale = (
        "The minimized packet does not indicate a pattern that needs expedited "
        "human review."
    )
    limitations = [
        "Only minimized structured context was provided.",
        "No raw audio, full transcript, or free-text evidence was available.",
    ]

    if payload.concern.evidenceSpanCount == 0:
        disposition = "insufficient_context"
        confidence = 0.18
        rationale = (
            "The minimized packet does not include enough evidence structure to "
            "support a stronger seriousness recommendation."
        )
    elif payload.concern.findingCode in {
        "medication-risk",
        "abrupt-session-termination",
    }:
        disposition = "expedited_human_review"
        confidence = 0.79
        rationale = (
            "The finding code maps to a higher-acuity review lane and should be "
            "triaged by a human reviewer."
        )

    return SeriousnessAssessmentModel(
        disposition=disposition,
        confidence=confidence,
        rationale=rationale,
        limitations=limitations,
        provider="doctor-auditor-assist-gateway",
        model="policy-heuristic-v1",
        assessedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
