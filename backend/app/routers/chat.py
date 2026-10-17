import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request

from app.config import settings
from app.redis_client import hit_rate_limit
from app.schemas import ChatIn
from app.services import assistant

router = APIRouter(tags=["assistant"])
log = logging.getLogger("truevalue.chat")
ANSWER_BUDGET = 45  # Vercel stops the function at 60 s; always reply before that


@router.post("/chat")
async def chat(body: ChatIn, request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "anon").split(",")[0]
    if await hit_rate_limit(f"rl:chat:{ip}", settings.CHAT_RATE_LIMIT_PER_MINUTE):
        raise HTTPException(429, "You're sending messages quickly. Wait a minute and try again.")
    location = body.location.model_dump() if body.location else None
    message = body.message.strip()
    try:
        return await asyncio.wait_for(assistant.answer(message, body.weights, location), timeout=ANSWER_BUDGET)
    except asyncio.TimeoutError:
        log.warning("chat answer took longer than %s s: %r", ANSWER_BUDGET, message[:80])
        return {"intent": "help", "parsed_by": "timeout", "message": message, "applied": {},
                "products": [], "comparison": None, "companies": [], "catalog_companies": [],
                "registry_note": None, "disposal": None, "places": None, "scan": None,
                "suggestions": [], "notes": [], "data_note": assistant.DATA_NOTE, "ai_summary": False,
                "summary": "One of the live data services (maps, Open Food Facts or the AI) is very slow right "
                           "now, so I couldn't finish that answer. Please try again in a moment."}
