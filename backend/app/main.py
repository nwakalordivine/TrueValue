import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app import models  # noqa: F401  registers tables before create_all
from app.config import settings
from app.database import Base, engine
from app.redis_client import ping as redis_ping
from app.routers import auth, catalog as catalog_router, chat, companies, diagnostics, feedback, me, places
from app.services import catalog, llm, registry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("truevalue")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.cloudinary_misconfigured:  # never log the value: it holds the API secret
        log.warning("CLOUDINARY_URL is set but is not cloudinary://<api_key>:<api_secret>@<cloud_name>; "
                    "profile pictures are off.")
    # Every Vercel cold start runs this before the first request is answered, so it uses as few database
    # round trips as it can: one query lists the tables, and tables are only created when some are missing
    # (create_all on its own asks about each of the 14 tables in turn).
    started = time.perf_counter()
    db_ready = False
    try:
        async with engine.begin() as conn:
            existing = set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
            missing = [t for t in Base.metadata.sorted_tables if t.name not in existing]
            if missing:
                if settings.is_postgres:
                    await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
                await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=missing))
                log.info("Created tables: %s", ", ".join(t.name for t in missing))
        db_ready = True
    except Exception as exc:  # noqa: BLE001
        log.error("Database setup failed, running on JSON fallback: %s", exc)
    db_done = time.perf_counter()
    await catalog.reload()
    if db_ready and catalog.source() != "database":  # empty catalog tables: seed them once, then load
        try:
            seeded = await catalog.seed_database()
            if seeded:
                log.info("Seeded demo catalog (%s records)", seeded)
                await catalog.reload()
        except Exception as exc:  # noqa: BLE001
            log.error("Seeding the catalog failed, running on JSON fallback: %s", exc)
    log.info("Startup: database %.2f s, catalog %.2f s (from %s)", db_done - started,
             time.perf_counter() - db_done, catalog.source())
    yield
    await engine.dispose()


app = FastAPI(title="TrueValue API", version="1.0.0",
              description="Ethical shopping assistant for the Tech Skills Showcase 2026", lifespan=lifespan)
origins = settings.cors_list
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials="*" not in origins,
                   allow_methods=["*"], allow_headers=["*"])

for r in (catalog_router.router, chat.router, companies.router, places.router, feedback.router, diagnostics.router,
          auth.router, me.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "catalog": catalog.source(), "ai": llm.enabled(), "redis": await redis_ping(),
            "registry_rows": await registry.count()}


@app.get("/")
async def root():
    return {"name": "TrueValue API", "docs": "/docs", "health": "/api/health"}