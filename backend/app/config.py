from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # the backend folder
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")
    DATABASE_URL: str = "sqlite+aiosqlite:///./truevalue.db"
    REDIS_URL: str = ""  # optional; the app works without it (no caching)

    OPENROUTER_API_KEY: str = ""  # optional; without it the assistant uses its rule-based mode
    LLM_MODEL_PRIMARY: str = "nvidia/nemotron-3-super-120b-a12b:free"
    LLM_MODEL_FALLBACK: str = ""
    LLM_TIMEOUT_SECONDS: float = 15

    # Feedback emails (Gmail: use an App Password, not your normal password)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    MAIL_FROM: str = ""
    FEEDBACK_EMAIL: str = ""  # where feedback is sent; empty = only saved in the database

    CORS_ORIGINS: str = "http://localhost:5173"  # comma separated, or *
    CHAT_RATE_LIMIT_PER_MINUTE: int = 20

    # Accounts (passwordless sign-in). Without JWT_SECRET the sign-in endpoints answer 503; the rest of the app works.
    JWT_SECRET: str = ""
    ACCESS_TOKEN_MINUTES: int = 60
    REFRESH_TOKEN_DAYS: int = 7
    LOGIN_CODE_MINUTES: int = 10
    CLOUDINARY_URL: str = ""  # cloudinary://<api_key>:<api_secret>@<cloud_name>; empty = no profile pictures
    ADMIN_EMAILS: str = ""  # comma separated; these signed-in users may read GET /api/feedback

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def auth_enabled(self) -> bool:
        return bool(self.JWT_SECRET)

    @property
    def avatars_enabled(self) -> bool:
        return bool(self.CLOUDINARY_URL)

    @property
    def admin_emails(self) -> set[str]:
        return {e.strip().lower() for e in self.ADMIN_EMAILS.split(",") if e.strip()}

    @property
    def is_postgres(self) -> bool:
        return self.DATABASE_URL.startswith("postgresql")


settings = Settings()
