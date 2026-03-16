from math import ceil

from fastapi import APIRouter, Depends, HTTPException

from app.api.cloud_models import AssistGatewayRequestModel, SeriousnessAssessmentModel
from app.services.assist_gateway_service import (
    AssistGatewayError,
    AssistGatewayRateLimitError,
    AssistGatewayService,
    AssistGatewayUnavailableError,
    AssistGatewayUpstreamError,
    AssistGatewayValidationError,
    get_assist_gateway_service,
)

router = APIRouter()


@router.post(
    "/seriousness-assessments",
    response_model=SeriousnessAssessmentModel,
)
async def create_seriousness_assessment(
    payload: AssistGatewayRequestModel,
    service: AssistGatewayService = Depends(get_assist_gateway_service),
):
    try:
        return await service.assess(payload)
    except AssistGatewayRateLimitError as exc:
        headers = None
        if exc.retry_after_seconds is not None:
            headers = {"Retry-After": str(max(1, ceil(exc.retry_after_seconds)))}
        raise HTTPException(status_code=429, detail=str(exc), headers=headers) from exc
    except AssistGatewayUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AssistGatewayValidationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except AssistGatewayUpstreamError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except AssistGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
