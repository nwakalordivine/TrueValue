from fastapi import APIRouter, HTTPException, Request

from app.config import settings
from app.redis_client import hit_rate_limit
from app.schemas import ChatIn
from app.services import assistant

router = APIRouter(tags=["assistant"])


@router.post("/chat")
async def chat(body: ChatIn, request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "anon").split(",")[0]
    if await hit_rate_limit(f"rl:chat:{ip}", settings.CHAT_RATE_LIMIT_PER_MINUTE):
        raise HTTPException(429, "You're sending messages quickly. Wait a minute and try again.")
    location = body.location.model_dump() if body.location else None
    return await assistant.answer(body.message.strip(), body.weights, location)
