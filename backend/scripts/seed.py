"""Reload the demo catalog (backend/data/*.json) into the database.

    uv run python -m scripts.seed          # only if empty (the API also does this on startup)
    uv run python -m scripts.seed --force  # overwrite after editing the JSON files
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sqlalchemy import text  # noqa: E402

from app import models  # noqa: E402,F401
from app.config import settings  # noqa: E402
from app.database import Base, engine  # noqa: E402
from app.services.catalog import seed_database  # noqa: E402


async def main(force: bool):
    async with engine.begin() as conn:
        if settings.is_postgres:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)
    n = await seed_database(force=force)
    print(f"Seeded {n} records" if n else "Catalog already present (use --force to overwrite)")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main("--force" in sys.argv))
