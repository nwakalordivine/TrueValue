import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class WeightsIn(BaseModel):
    weights: dict[str, float] | None = None  # dimension_id -> 0..100; defaults used when missing


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=400)
    weights: dict[str, float] | None = None
    location: Location | None = None


class FeedbackIn(BaseModel):
    product_id: str | None = Field(default=None, max_length=64)
    product_name: str | None = Field(default=None, max_length=120)
    issue: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=1000)


# ----- accounts -----
_USERNAME = re.compile(r"^[\w .\-]+$")  # \w: letters (accented too), numbers and _


def _clean_username(value: str) -> str:
    value = value.strip()
    if not 2 <= len(value) <= 30:
        raise ValueError("Username must be 2 to 30 characters.")
    if not _USERNAME.match(value):
        raise ValueError("Username can use letters, numbers, spaces, _, . and - only.")
    return value


def _clean_email(value: str) -> str:
    return value.strip().lower()


Username = Annotated[str, AfterValidator(_clean_username)]
Email = Annotated[EmailStr, AfterValidator(_clean_email)]
Code = Annotated[str, Field(pattern=r"^\d{6}$")]


class RequestCodeIn(BaseModel):
    email: Email
    username: Username | None = None  # needed only when the email is new


class VerifyCodeIn(BaseModel):
    email: Email
    code: Code
    username: Username | None = None  # needed only when the email is new (the account is created here)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=2000)


class UsernameIn(BaseModel):
    username: Username


class PreferencesIn(BaseModel):
    weights: dict[str, Annotated[float, Field(ge=0, le=100)]]  # dimension_id -> 0..100 (ids checked in the router)
    budget_cad: float = Field(ge=0, le=10000)


class EmailRequestIn(BaseModel):
    new_email: Email


class EmailConfirmIn(BaseModel):
    new_email: Email
    code: Code
