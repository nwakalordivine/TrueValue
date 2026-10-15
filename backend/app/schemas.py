from pydantic import BaseModel, Field


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
    issue: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=1000)
