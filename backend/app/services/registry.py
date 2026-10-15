"""Search the real federal corporations registry (Corporations Canada, CBCA, active).

What a match proves: the company is a federally incorporated, active corporation with
a registered office in Canada. What it does NOT prove: Canadian ownership (foreign
companies incorporate Canadian subsidiaries), or where products are made. Companies
incorporated only provincially are not in this dataset, so "not found" means Unknown.
"""
from __future__ import annotations

import re
import unicodedata

from sqlalchemy import text

from app.database import SessionLocal

SUFFIXES = {"INC", "INCORPORATED", "INCORPOREE", "LTD", "LIMITED", "LTEE", "LIMITEE", "CORP", "CORPORATION",
            "CO", "COMPANY", "CIE", "ULC", "LLC", "LLP", "LP", "SENC", "SA", "THE"}
NUMBERED = re.compile(r"^\d+ CANADA (INC|LTD|LTEE|LTÉE|CORP|LIMITED|LIMITEE|CORPORATION)\b", re.IGNORECASE)

WHAT_IT_PROVES = ("Federal registration confirms this Canadian corporation exists and is active. "
                  "It does not confirm who owns it or where products are made.")
NOT_FOUND = ("Not found in the federal registry. Many Canadian companies are incorporated provincially, "
             "so this is Unknown, not 'not Canadian'.")
SOURCE = {"title": "Corporations Canada: active CBCA corporations (open data)",
          "url": "https://open.canada.ca/data/en/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2"}


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    s = s.replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    words = s.split()
    while words and words[-1] in SUFFIXES:
        words.pop()
    while words and words[0] == "THE":
        words.pop(0)
    return " ".join(words)


def is_numbered(name: str) -> bool:
    return bool(NUMBERED.match(name or ""))


def _company_out(row: dict, match_type: str) -> dict:
    city = (row.get("city") or "").title() or None
    office = ", ".join(x for x in [city, row.get("province")] if x) or None
    return {
        "corporation_number": row["corporation_number"],
        "name": row["name"],
        "alt_name": row.get("alt_name"),
        "match_type": match_type,
        "city": city,
        "province": row.get("province"),
        "incorporated_on": row["incorporated_on"].isoformat() if row.get("incorporated_on") else None,
        "last_filing_year": row.get("last_filing_year"),
        "status_detail": row.get("status_detail"),
        "facts": {
            "federally_registered": {"value": True, "status": "Verified"},
            "registered_office": {"value": office, "status": "Verified"},
            "canadian_owned": {"value": None, "status": "Unknown"},
        },
        "what_it_proves": WHAT_IT_PROVES,
        "source": SOURCE,
    }


async def search_companies(query: str, limit: int = 5) -> dict:
    q = normalize_name(query)
    if len(q) < 2:
        return {"query": query, "items": [], "note": "Type at least two letters."}
    allow_numbered = q.split()[0].isdigit()
    sql = text("""
        SELECT corporation_number, name, alt_name, name_normalized, status_detail, incorporated_on,
               last_filing_year, city, province,
               word_similarity(:q, name_normalized) AS wsim, similarity(:q, name_normalized) AS sim
        FROM corporations
        WHERE (name_normalized = :q OR :q <% name_normalized)
          AND (:allow_numbered OR NOT is_numbered)
        ORDER BY (name_normalized = :q) DESC, wsim DESC, sim DESC, length(name_normalized)
        LIMIT :limit
    """)
    try:
        async with SessionLocal() as db:
            await db.execute(text("SET pg_trgm.word_similarity_threshold = 0.6"))
            rows = (await db.execute(sql, {"q": q, "limit": limit, "allow_numbered": allow_numbered})).mappings().all()
    except Exception as exc:  # noqa: BLE001
        return {"query": query, "items": [], "error": "registry_unavailable",
                "note": f"The registry search is not available right now ({type(exc).__name__}). "
                        "Has scripts/import_corporations.py been run?"}
    items = []
    for r in rows:
        r = dict(r)
        if r["name_normalized"] == q:
            mt = "exact"
        elif r["wsim"] >= 0.99:
            mt = "contains"
        else:
            mt = "similar"
        items.append(_company_out(r, mt))
    return {"query": query, "items": items, "note": None if items else NOT_FOUND}


async def get_company(corporation_number: str) -> dict | None:
    sql = text("""SELECT corporation_number, name, alt_name, status_detail, incorporated_on, last_filing_year,
                         city, province FROM corporations WHERE corporation_number = :n""")
    async with SessionLocal() as db:
        row = (await db.execute(sql, {"n": corporation_number})).mappings().first()
    return _company_out(dict(row), "exact") if row else None


async def count() -> int | None:
    try:
        async with SessionLocal() as db:
            return (await db.execute(text("SELECT count(*) FROM corporations"))).scalar()
    except Exception:  # noqa: BLE001
        return None
