import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import models  # noqa: F401  registers tables before create_all
from app.config import settings
from app.database import Base, engine
from app.redis_client import ping as redis_ping
from app.routers import catalog as catalog_router, chat, companies, diagnostics, feedback, places
from app.services import catalog, llm, registry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("truevalue")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with engine.begin() as conn:
            if settings.is_postgres:
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.run_sync(Base.metadata.create_all)
        seeded = await catalog.seed_database()
        if seeded:
            log.info("Seeded demo catalog (%s records)", seeded)
    except Exception as exc:  # noqa: BLE001
        log.error("Database setup failed, running on JSON fallback: %s", exc)
    await catalog.reload()
    log.info("Catalog loaded from %s", catalog.source())
    yield
    await engine.dispose()


app = FastAPI(title="TrueValue API", version="1.0.0",
              description="Ethical shopping assistant for the Tech Skills Showcase 2026", lifespan=lifespan)
origins = settings.cors_list
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials="*" not in origins,
                   allow_methods=["*"], allow_headers=["*"])

for r in (catalog_router.router, chat.router, companies.router, places.router, feedback.router, diagnostics.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "catalog": catalog.source(), "ai": llm.enabled(), "redis": await redis_ping(),
            "registry_rows": await registry.count()}


@app.get("/")
async def root():
    return {"name": "TrueValue API", "docs": "/docs", "health": "/api/health"}