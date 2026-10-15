from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # the backend folder
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    # Neon: postgresql+asyncpg://user:pass@host/neondb?ssl=require
    DATABASE_URL: str = "sqlite+aiosqlite:///./truevalue.db"
    REDIS_URL: str = ""  # optional; the app works without it (no caching)

    OPENROUTER_API_KEY: str = ""  # optional; without it the assistant uses its rule-based mode
    LLM_MODEL_PRIMARY: str = "nvidia/nemotron-3.5-lightning:free"
    LLM_MODEL_FALLBACK: str = "nvidia/nemotron-3-super-120b-a12b:free"
    LLM_TIMEOUT_SECONDS: float = 25

    # Feedback emails (Gmail: use an App Password, not your normal password)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    MAIL_FROM: str = ""
    FEEDBACK_EMAIL: str = ""  # where feedback is sent; empty = only saved in the database

    CORS_ORIGINS: str = "http://localhost:5173"  # comma separated, or *
    CHAT_RATE_LIMIT_PER_MINUTE: int = 20

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_postgres(self) -> bool:
        return self.DATABASE_URL.startswith("postgresql")


settings = Settings()
