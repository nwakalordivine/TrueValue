"""The demo catalog (products, companies, claims, ...).

It is small, so we load it from Postgres into memory once and serve it from there.
If the database is unreachable we fall back to the JSON files in backend/data, so
the demo keeps working.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import delete, func, select

from app.config import DATA_DIR
from app.database import SessionLocal
from app.models import CATALOG_TABLES, Product

log = logging.getLogger("truevalue.catalog")

_catalog: dict | None = None
_source = "not loaded"


def load_json_files() -> dict:
    return {name: json.loads((DATA_DIR / f"{name}.json").read_text(encoding="utf-8")) for name in CATALOG_TABLES}


async def seed_database(force: bool = False) -> int:
    """Copy backend/data/*.json into Postgres. Skips if products already exist, unless force."""
    data = load_json_files()
    async with SessionLocal() as db:
        existing = await db.scalar(select(func.count()).select_from(Product))
        if existing and not force:
            return 0
        for name, (model, cols) in CATALOG_TABLES.items():
            await db.execute(delete(model))
            for record in data[name]:
                db.add(model(**{col: record.get(field) for col, field in cols.items()}, data=record))
        await db.commit()
    return sum(len(v) for v in data.values())


async def reload() -> None:
    global _catalog, _source
    try:
        out = {}
        async with SessionLocal() as db:
            for name, (model, _) in CATALOG_TABLES.items():
                rows = (await db.scalars(select(model))).all()
                out[name] = [r.data for r in rows]
        if not out["products"]:
            raise RuntimeError("catalog tables are empty")
        out["products"].sort(key=lambda p: int("".join(ch for ch in p["product_id"] if ch.isdigit()) or 0))
        _catalog, _source = out, "database"
    except Exception as exc:  # noqa: BLE001
        log.warning("Using JSON fallback for catalog: %s", exc)
        _catalog, _source = load_json_files(), "json-fallback"


def get() -> dict:
    global _catalog, _source
    if _catalog is None:
        _catalog, _source = load_json_files(), "json-fallback"
    return _catalog


def source() -> str:
    return _source


def product_by_id(product_id: str) -> dict | None:
    return next((p for p in get()["products"] if p["product_id"] == product_id), None)


def company_chain(company_id: str | None) -> list[dict]:
    companies, chain, seen = get()["companies"], [], set()
    while company_id and company_id not in seen:
        seen.add(company_id)
        c = next((x for x in companies if x["company_id"] == company_id), None)
        if not c:
            break
        chain.append(c)
        company_id = c.get("parent_company_id")
    return chain


def default_weights() -> dict:
    return {d["dimension_id"]: d["default_weight"] for d in get()["ethicalDimensions"]}
