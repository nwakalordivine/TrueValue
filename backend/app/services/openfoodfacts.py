"""Real products by barcode from Open Food Facts (open community database).

We turn label and community data into TrueValue claims. Everything from Open Food Facts
is marked "Claimed": it comes from packaging labels and volunteers, not independent
verification. Missing data stays "Unknown" and is never scored as zero.
"""
from __future__ import annotations

import logging
import re

import httpx

from app.redis_client import cache_get, cache_set
from app.services import disposal

log = logging.getLogger("truevalue.off")
SOURCE_ID = "src-off"
FIELDS = ("code,product_name,product_name_en,brands,brand_owner,manufacturing_places,origins,countries,labels,"
          "labels_tags,categories_tags,ecoscore_grade,environmental_score_grade,packagings,packaging,"
          "packaging_materials_tags,image_front_url,quantity")
USER_AGENT = "TrueValue/1.0 (Tech Skills Showcase 2026 demo)"

CATEGORY_MAP = [("coffee", "Coffee"), ("chocolate", "Chocolate"), ("spread", "Spreads"), ("honey", "Spreads"),
                ("snack", "Snacks"), ("chip", "Snacks"), ("breakfast", "Breakfast"), ("cereal", "Breakfast"),
                ("beverage", "Beverages"), ("drink", "Beverages"), ("water", "Beverages")]
GRADE_SCORE = {"a-plus": 95, "a": 90, "b": 75, "c": 55, "d": 35, "e": 15, "f": 10}


def valid_barcode(code: str) -> str | None:
    digits = re.sub(r"\D", "", code or "")
    return digits if 8 <= len(digits) <= 14 else None


async def fetch(code: str) -> dict | None:
    key = f"off:{code}"
    cached = await cache_get(key)
    if cached is not None:
        return cached or None  # {} means "known not found"
    url = f"https://world.openfoodfacts.org/api/v2/product/{code}.json?fields={FIELDS}"
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as client:
        resp = await client.get(url)
    if resp.status_code == 404:
        await cache_set(key, {}, ttl=3600)
        return None
    resp.raise_for_status()
    data = resp.json()
    product = data.get("product") if data.get("status") == 1 else None
    await cache_set(key, product or {}, ttl=24 * 3600)
    return product


def _clean_tags(tags) -> list[str]:
    return [t.split(":", 1)[-1].replace("-", " ") for t in (tags or [])]


def _materials(p: dict) -> list[str]:
    out = []
    for item in p.get("packagings") or []:
        mat = _clean_tags([item.get("material")])[0] if item.get("material") else ""
        shape = _clean_tags([item.get("shape")])[0] if item.get("shape") else ""
        name = " ".join(x for x in [mat, shape] if x).strip()
        if name:
            out.append(name.capitalize())
    if not out:
        out = [m.capitalize() for m in _clean_tags(p.get("packaging_materials_tags"))]
    if not out and p.get("packaging"):
        out = [x.strip().capitalize() for x in str(p["packaging"]).split(",") if x.strip()][:4]
    return list(dict.fromkeys(out))[:5]


def _claim(pid, dim, score, text):
    known = score is not None
    return {"claim_id": f"cl-{pid}-{dim}", "product_id": pid, "company_id": None, "dimension_id": dim,
            "claim_text": text, "claim_source": "Open Food Facts" if known else None, "evidence_url": None,
            "status": "Claimed" if known else "Unknown", "verified_by": None,
            "source_id": SOURCE_ID, "raw_score": score, "confidence": 0.35 if known else 0,
            "coverage_percent": 100 if known else 0}


def to_truevalue(p: dict) -> tuple[dict, list[dict], dict]:
    """Open Food Facts product -> (catalog-style product, claims, plain facts for display)."""
    code = p.get("code")
    pid = f"off-{code}"
    labels = " ".join(_clean_tags(p.get("labels_tags"))).lower() + " " + (p.get("labels") or "").lower()
    made = (p.get("manufacturing_places") or "").strip()
    made_l = made.lower()
    origins = (p.get("origins") or "").strip()
    cats = " ".join(p.get("categories_tags") or []).lower()
    category = next((c for k, c in CATEGORY_MAP if k in cats), None)
    materials = _materials(p)

    # Buy Canadian
    if "product of canada" in labels:
        canadian = (85, "Label says Product of Canada")
    elif "made in canada" in labels or "canada" in made_l:
        canadian = (70, "Label or listing says made in Canada (ingredients may be imported)")
    elif made:
        canadian = (15, f"Manufactured in {made}")
    else:
        canadian = (None, "Manufacturing place not reported")
    # Local (Saskatchewan)
    if any(w in made_l for w in ("saskatchewan", "regina", "saskatoon")):
        local = (85, f"Made in {made}")
    elif made:
        local = (20, f"Made in {made}, not Saskatchewan")
    else:
        local = (None, "Manufacturing place not reported")
    # Fair trade
    fair = (85, "Fair trade style label on pack") if any(
        w in labels for w in ("fair trade", "fairtrade", "rainforest alliance", "utz")) else (None, "No fair trade label reported")
    # Animal welfare
    if "vegan" in labels:
        animal = (85, "Vegan label")
    elif any(w in labels for w in ("free range", "cage free", "organic", "certified humane")):
        animal = (70, "Animal welfare or organic label")
    else:
        animal = (None, "No animal welfare label reported")
    # Environment: Open Food Facts environmental score (computed by OFF from community data)
    grade = (p.get("environmental_score_grade") or p.get("ecoscore_grade") or "").lower()
    if grade in GRADE_SCORE:
        env = (GRADE_SCORE[grade], f"Open Food Facts environmental score: {grade.upper()}")
    elif "organic" in labels:
        env = (65, "Organic label")
    else:
        env = (None, "No environmental data")
    # Packaging, scored with the real Regina rules
    bins = [disposal.classify(m)["bin"] for m in materials]
    if not bins:
        pack = (None, "Packaging not reported")
    elif all(b == "blue_cart" for b in bins):
        pack = (75, "All packaging goes in Regina's blue cart")
    elif "check" in bins:
        pack = (45, "Some packaging needs checking in the Regina Waste Wizard")
    elif any(b == "sarcan" for b in bins):
        pack = (50, "Some packaging must go to a SARCAN depot")
    else:
        pack = (70, "Deposit container: return to SARCAN for a refund")

    dims = {"canadian_ownership": canadian, "local_business": local, "fair_trade": fair,
            "animal_welfare": animal, "environment": env, "packaging": pack}
    claims = [_claim(pid, d, s, t) for d, (s, t) in dims.items()]
    name = p.get("product_name") or p.get("product_name_en") or "Unnamed product"
    product = {
        "product_id": pid, "barcode": code, "name": name, "brand": (p.get("brands") or "").split(",")[0].strip() or None,
        "company_id": None, "category": category,
        "country_of_manufacture": made or None,
        "country_of_origin_components": [f"Origins: {origins}"] if origins else [],
        "packaging": {"materials": materials, "status": "Claimed" if materials else "Unknown",
                      "source_id": SOURCE_ID},
        "source_id": SOURCE_ID, "emoji": "📦", "size": p.get("quantity"),
    }
    facts = {
        "brand_owner": p.get("brand_owner"), "manufacturing_places": made or None, "origins": origins or None,
        "countries_sold": p.get("countries"), "labels": p.get("labels"), "image": p.get("image_front_url"),
        "reasons": {d: t for d, (s, t) in dims.items()},
        "url": f"https://world.openfoodfacts.org/product/{code}",
    }
    return product, claims, facts


SEARCH_FIELDS = "code,product_name,product_name_en,brands,quantity,image_front_small_url,countries_tags"


def _search_item(p: dict) -> dict | None:
    code = valid_barcode(str(p.get("code") or ""))
    name = p.get("product_name") or p.get("product_name_en")
    if not code or not name:
        return None
    brands = p.get("brands") or ""
    if isinstance(brands, list):
        brands = ", ".join(brands)
    return {"barcode": code, "name": name.strip(), "brand": brands.split(",")[0].strip() or None,
            "quantity": p.get("quantity"), "image": p.get("image_front_small_url"),
            "sold_in_canada": "en:canada" in (p.get("countries_tags") or []), "source": "openfoodfacts"}


async def search(query: str, limit: int = 12) -> list[dict]:
    """Real products by name. Products sold in Canada first, then the rest of the world."""
    q = " ".join(query.split())[:80]
    key = f"offsearch:{q.lower()}:{limit}"
    cached = await cache_get(key)
    if cached is not None:
        return cached
    base = "https://world.openfoodfacts.org/cgi/search.pl"
    common = {"search_terms": q, "search_simple": 1, "action": "process", "json": 1,
              "page_size": limit, "fields": SEARCH_FIELDS, "sort_by": "unique_scans_n"}
    canada = {**common, "tagtype_0": "countries", "tag_contains_0": "contains", "tag_0": "canada"}
    items: list[dict] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=6), headers={"User-Agent": USER_AGENT}) as client:
        for params in (canada, common):
            if len(items) >= limit:
                break
            resp = await client.get(base, params=params)
            resp.raise_for_status()
            for p in resp.json().get("products", []):
                item = _search_item(p)
                if item and all(i["barcode"] != item["barcode"] for i in items):
                    items.append(item)
    items = items[:limit]
    await cache_set(key, items, ttl=6 * 3600)
    return items
