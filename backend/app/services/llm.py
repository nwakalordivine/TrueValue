"""OpenRouter client. Free models are limited (50 requests/day without credits, and failed
calls still count), so we retry at most once per model and always have a non-AI fallback."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time

import httpx

from app.config import settings

log = logging.getLogger("truevalue.llm")
URL = "https://openrouter.ai/api/v1/chat/completions"


def enabled() -> bool:
    return bool(settings.OPENROUTER_API_KEY)


def _extract_json(text: str) -> dict | None:
    text = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
    return None


async def complete_json(system: str, user: str, max_tokens: int = 400, budget: float = 9.0) -> dict | None:
    """Ask the model for a JSON object within `budget` seconds in total (both models together).
    Returns None if no key, too slow, no answer or no valid JSON, so callers fall back to templates.
    Free models are often slow; the hard budget keeps every chat reply well under the 60 s limit."""
    if not enabled():
        return None
    headers = {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
               "HTTP-Referer": "https://truevalue.local", "X-Title": "TrueValue"}
    deadline = time.monotonic() + min(budget, settings.LLM_TIMEOUT_SECONDS)
    async with httpx.AsyncClient() as client:
        for model in [settings.LLM_MODEL_PRIMARY, settings.LLM_MODEL_FALLBACK]:
            remaining = deadline - time.monotonic()
            if not model or remaining < 1.5:
                continue
            body = {"model": model, "temperature": 0.1, "max_tokens": max_tokens,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
            try:
                resp = await asyncio.wait_for(
                    client.post(URL, headers=headers, json=body, timeout=remaining), timeout=remaining)
                if resp.status_code != 200:
                    log.warning("LLM %s returned %s: %s", model, resp.status_code, resp.text[:200])
                    continue
                content = resp.json()["choices"][0]["message"].get("content") or ""
                parsed = _extract_json(content)
                if isinstance(parsed, dict):
                    return parsed
                log.warning("LLM %s returned non-JSON content", model)
            except asyncio.TimeoutError:
                log.warning("LLM %s too slow (budget used up), using the non-AI fallback", model)
            except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
                log.warning("LLM %s failed: %s %s", model, type(exc).__name__, exc)
    return None
