"""OpenRouter client. Free models are limited (50 requests/day without credits, and failed
calls still count), so we retry at most once per model and always have a non-AI fallback."""
from __future__ import annotations

import json
import logging
import re

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


async def complete_json(system: str, user: str, max_tokens: int = 400) -> dict | None:
    """Ask the model for a JSON object. Returns None if no key, no answer or no valid JSON."""
    if not enabled():
        return None
    headers = {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
               "HTTP-Referer": "https://truevalue.local", "X-Title": "TrueValue"}
    async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT_SECONDS) as client:
        for model in [settings.LLM_MODEL_PRIMARY, settings.LLM_MODEL_FALLBACK]:
            if not model:
                continue
            body = {"model": model, "temperature": 0.1, "max_tokens": max_tokens,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
            try:
                resp = await client.post(URL, headers=headers, json=body)
                if resp.status_code != 200:
                    log.warning("LLM %s returned %s: %s", model, resp.status_code, resp.text[:200])
                    continue
                content = resp.json()["choices"][0]["message"].get("content") or ""
                parsed = _extract_json(content)
                if isinstance(parsed, dict):
                    return parsed
                log.warning("LLM %s returned non-JSON content", model)
            except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
                log.warning("LLM %s failed: %s", model, exc)
    return None
