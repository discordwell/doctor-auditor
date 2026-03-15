from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://doctor_auditor:doctor_auditor@localhost:5432/doctor_auditor"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    class Config:
        env_file = ".env"


settings = Settings()
