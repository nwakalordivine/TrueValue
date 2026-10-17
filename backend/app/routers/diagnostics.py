"""GET /api/diagnostics: times every outside service the backend depends on, from inside Vercel.

Each check runs on its own with a 20 s limit and reports ok / HTTP status / error and how long it took,
so we can see exactly which service is slow or broken instead of guessing.
"""
import asyncio
import time

import httpx
from fastapi import APIRouter
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.redis_client import redis
from app.services import places

router = APIRouter(tags=["diagnostics"])
UA = {"User-Agent": places.USER_AGENT}
LIMIT = 20


async def _timed(name, coro):
    start = time.monotonic()
    try:
        detail = await asyncio.wait_for(coro, timeout=LIMIT)
        ok = True
    except asyncio.TimeoutError:
        ok, detail = False, f"no answer within {LIMIT} s"
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, f"{type(exc).__name__}: {str(exc)[:200]}"
    return {"service": name, "ok": ok, "seconds": round(time.monotonic() - start, 2), "detail": detail}


async def _neon():
    async with SessionLocal() as db:
        rows = (await db.execute(text("SELECT count(*) FROM products"))).scalar()
    return f"{rows} products in the database"


async def _redis():
    if not redis:
        return "not configured (optional)"
    await redis.ping()
    return "pong"


async def _get(url, **kw):
    async with httpx.AsyncClient(headers=UA, timeout=LIMIT) as c:
        r = await c.get(url, **kw)
    return f"HTTP {r.status_code}"


async def _overpass(url):
    q = '[out:json][timeout:15];node["shop"="supermarket"](around:2000,50.4452,-104.6189);out 5;'
    async with httpx.AsyncClient(headers=UA, timeout=LIMIT) as c:
        r = await c.post(url, data={"data": q})
    return f"HTTP {r.status_code}, {len(r.json().get('elements', [])) if r.status_code == 200 else 0} shops"


async def _openrouter(model):
    if not settings.OPENROUTER_API_KEY:
        return "no API key set"
    async with httpx.AsyncClient(timeout=LIMIT) as c:
        r = await c.post("https://openrouter.ai/api/v1/chat/completions",
                         headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"},
                         json={"model": model, "max_tokens": 5,
                               "messages": [{"role": "user", "content": "Say ok"}]})
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:160]}")
    return "answered"


@router.get("/diagnostics")
async def diagnostics():
    checks = [
        ("Neon database", _neon()),
        ("Redis cache", _redis()),
        (f"AI primary ({settings.LLM_MODEL_PRIMARY})", _openrouter(settings.LLM_MODEL_PRIMARY)),
        (f"AI fallback ({settings.LLM_MODEL_FALLBACK})", _openrouter(settings.LLM_MODEL_FALLBACK)),
        ("Open Food Facts barcode", _get("https://world.openfoodfacts.org/api/v2/product/3017620422003.json",
                                         params={"fields": "code"})),
        ("Open Food Facts search", _get("https://search.openfoodfacts.org/search",
                                        params={"q": "spring water", "page_size": 1})),
        ("Nominatim (map backup)", _get(places.NOMINATIM_URL, params={"q": "SARCAN Regina", "format": "jsonv2"})),
    ] + [(f"Overpass {u.split('/')[2]}", _overpass(u)) for u in places.OVERPASS_URLS]
    results = await asyncio.gather(*[_timed(n, c) for n, c in checks])
    return {"all_ok": all(r["ok"] for r in results), "checks": results}