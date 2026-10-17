"""Redis is optional. Every helper fails soft so a Redis outage never breaks the demo."""
import json
import logging

from redis.asyncio import Redis

from app.config import settings

log = logging.getLogger("truevalue.redis")
redis: Redis | None = Redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=2, socket_timeout=2) if settings.REDIS_URL else None


async def cache_get(key: str):
    if not redis:
        return None
    try:
        raw = await redis.get(key)
        return json.loads(raw) if raw else None
    except Exception as exc:  # noqa: BLE001
        log.warning("redis get failed: %s", exc)
        return None


async def cache_set(key: str, value, ttl: int = 3600) -> None:
    if not redis:
        return
    try:
        await redis.set(key, json.dumps(value), ex=ttl)
    except Exception as exc:  # noqa: BLE001
        log.warning("redis set failed: %s", exc)


async def hit_rate_limit(key: str, limit: int, window_seconds: int = 60) -> bool:
    """True when the caller is over the limit."""
    if not redis:
        return False
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window_seconds)
        return count > limit
    except Exception as exc:  # noqa: BLE001
        log.warning("redis rate limit failed: %s", exc)
        return False


async def ping() -> bool:
    if not redis:
        return False
    try:
        return bool(await redis.ping())
    except Exception:  # noqa: BLE001
        return False
