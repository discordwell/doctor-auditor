from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_DEV_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://localhost:5173",
)


class Settings(BaseSettings):
    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+asyncpg://doctor_auditor:doctor_auditor@db:5432/doctor_auditor"
    jwt_secret: str = "change-me-in-production"
    jwt_secret_fallbacks: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    cors_allowed_origins: str = ""
    log_level: str = "INFO"
    openai_api_key: str | None = None
    openai_api_base_url: str = "https://api.openai.com/v1"
    assist_gateway_enabled: bool = True
    assist_gateway_model: str = "gpt-5.4"
    assist_gateway_prompt_version: str = "seriousness-triage-v1"
    assist_gateway_timeout_seconds: float = 20.0
    assist_gateway_max_retries: int = 2
    assist_gateway_retry_backoff_seconds: float = 0.75
    assist_gateway_rate_limit_window_seconds: int = 60
    assist_gateway_global_requests_per_window: int = 60
    assist_gateway_requester_requests_per_window: int = 12
    assist_gateway_max_output_tokens: int = 400
    assist_gateway_reasoning_effort: Literal["minimal", "low", "medium", "high"] = (
        "medium"
    )
    assist_gateway_verbosity: Literal["low", "medium", "high"] = "low"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def async_database_url(self) -> str:
        """Ensure the database URL uses the asyncpg driver."""
        url = self.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        configured_origins = [
            origin.strip()
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]
        if configured_origins:
            return configured_origins
        if self.app_env == "development":
            return list(LOCAL_DEV_CORS_ORIGINS)
        return []

    @property
    def jwt_decode_secrets(self) -> list[str]:
        fallbacks = [
            value.strip() for value in self.jwt_secret_fallbacks.split(",") if value.strip()
        ]
        return [self.jwt_secret, *fallbacks]

    def validate_deployment(self) -> None:
        if self.app_env != "production":
            return
        errors: list[str] = []
        if not self.cors_origin_list:
            errors.append("CORS_ALLOWED_ORIGINS must list the allowed frontend origin(s)")
        if self.jwt_secret == "change-me-in-production":
            errors.append("JWT_SECRET must be set to a production secret")
        if not self.async_database_url.startswith(
            ("postgresql://", "postgresql+asyncpg://")
        ):
            errors.append("DATABASE_URL must point to Postgres in production")
        if errors:
            raise ValueError("; ".join(errors))


settings = Settings()
