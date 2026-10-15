"""Load the Corporations Canada CSV (active CBCA corporations) into the `corporations` table.

Usage (from the backend folder):
    uv run python -m scripts.import_corporations path/to/corporations-active-cbca-en.csv
    uv run python -m scripts.import_corporations data/corporations.csv --provinces SK,MB,AB   (smaller import)

Safe to rerun: it empties the table first. Uses Postgres COPY. Numbered companies (about 250k rows) are
skipped by default, leaving about 395k named corporations.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import sys
import time
from datetime import date
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings  # noqa: E402
from app.services.registry import is_numbered, normalize_name  # noqa: E402

COLUMNS = ["corporation_number", "business_number", "name", "alt_name", "name_normalized", "status_detail",
           "incorporated_on", "last_filing_year", "city", "province", "postal_code", "is_numbered"]
BATCH = 25_000


def plain_dsn(url: str) -> str:
    """SQLAlchemy URL -> asyncpg DSN (drop +asyncpg, ssl=require -> sslmode=require)."""
    url = url.replace("postgresql+asyncpg://", "postgresql://").replace("postgres+asyncpg://", "postgresql://")
    return url.replace("ssl=require", "sslmode=require")


def parse_date(value: str):
    try:
        return date.fromisoformat(value[:10]) if value else None
    except ValueError:
        return None


def parse_int(value: str):
    try:
        return int(value) if value else None
    except ValueError:
        return None


def clean_postal(value: str):
    v = (value or "").replace(" ", "").upper()
    return f"{v[:3]} {v[3:]}" if len(v) == 6 else (v or None)


def rows(path: Path, provinces: set[str] | None, include_numbered: bool = False):
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            prov = (r.get("Province/territory") or "").strip().upper() or None
            if provinces and prov not in provinces:
                continue
            name = (r.get("Corporate name - form 1") or "").strip()
            if not name or (not include_numbered and is_numbered(name)):
                continue
            yield (
                r["Corporation number"].strip(),
                (r.get("Business number (BN)") or "").strip() or None,
                name[:512],
                (r.get("Corporate name - form 2") or "").strip()[:512] or None,
                normalize_name(name)[:512],
                (r.get("Status Detail") or "").strip() or None,
                parse_date(r.get("Anniversary date", "")),
                parse_int(r.get("Year of last annual filing", "")),
                (r.get("City/town") or "").strip().title()[:128] or None,
                prov,
                clean_postal(r.get("Postal code", "")),
                is_numbered(name),
            )


async def main(csv_path: str, provinces: str | None, include_numbered: bool):
    if not settings.is_postgres:
        sys.exit("DATABASE_URL must point to Postgres (Neon) for the registry import.")
    path = Path(csv_path)
    if not path.exists():
        sys.exit(f"CSV not found: {path}")
    prov_set = {p.strip().upper() for p in provinces.split(",")} if provinces else None
    started = time.time()
    conn = await asyncpg.connect(plain_dsn(settings.DATABASE_URL))
    try:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS corporations (
                corporation_number varchar(16) PRIMARY KEY, business_number varchar(16), name varchar(512) NOT NULL,
                alt_name varchar(512), name_normalized varchar(512) NOT NULL, status_detail varchar(128),
                incorporated_on date, last_filing_year integer, city varchar(128), province varchar(8),
                postal_code varchar(10), is_numbered boolean NOT NULL DEFAULT false)""")
        await conn.execute("DROP INDEX IF EXISTS ix_corporations_name_trgm")
        await conn.execute("TRUNCATE corporations")
        batch, total, seen = [], 0, set()
        for rec in rows(path, prov_set, include_numbered):
            if rec[0] in seen:  # guard against duplicate corporation numbers
                continue
            seen.add(rec[0])
            batch.append(rec)
            if len(batch) >= BATCH:
                await conn.copy_records_to_table("corporations", records=batch, columns=COLUMNS)
                total += len(batch)
                batch.clear()
                print(f"  {total:,} rows...", flush=True)
        if batch:
            await conn.copy_records_to_table("corporations", records=batch, columns=COLUMNS)
            total += len(batch)
        print("Building search indexes (this can take a minute)...", flush=True)
        await conn.execute("CREATE INDEX ix_corporations_name_trgm ON corporations "
                           "USING gin (name_normalized gin_trgm_ops)")
        await conn.execute("CREATE INDEX IF NOT EXISTS ix_corporations_province ON corporations (province)")
        await conn.execute("ANALYZE corporations")
        size = await conn.fetchval("SELECT pg_size_pretty(pg_total_relation_size('corporations'))")
        print(f"Done: {total:,} corporations in {time.time() - started:.0f}s. Table size with indexes: {size}")
    finally:
        await conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path")
    ap.add_argument("--provinces", help="Only import these provinces, e.g. SK,MB,AB (smaller database)")
    ap.add_argument("--include-numbered", action="store_true",
                    help="Also import numbered companies like '8448566 CANADA INC.' (skipped by default: "
                         "about 39%% of rows, no use for name search)")
    args = ap.parse_args()
    asyncio.run(main(args.csv_path, args.provinces, args.include_numbered))
