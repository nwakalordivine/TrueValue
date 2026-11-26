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

# Shopper words -> Open Food Facts category tag, so "canned water" finds waters, not artichokes canned in water.
# Longer phrases first. Every tag was checked against the live search server (Nov 2026) and returns Canadian products.
CATEGORY_TAGS = [
    ("peanut butter", "en:peanut-butters"), ("oat milk", "en:plant-based-milk-alternatives"),
    ("oat drink", "en:plant-based-milk-alternatives"), ("almond milk", "en:plant-based-milk-alternatives"),
    ("water", "en:waters"), ("coffee", "en:coffees"), ("espresso", "en:coffees"), ("tea", "en:teas"),
    ("juice", "en:fruit-juices"), ("milk", "en:milks"), ("soda", "en:sodas"), ("pop", "en:sodas"),
    ("chocolate", "en:chocolates"), ("honey", "en:honeys"), ("jam", "en:jams"),
    ("cereal", "en:breakfast-cereals"), ("granola", "en:mueslis"), ("muesli", "en:mueslis"),
    ("chips", "en:chips-and-fries"), ("crisps", "en:chips-and-fries"), ("cookie", "en:biscuits"),
    ("biscuit", "en:biscuits"), ("pasta", "en:pastas"), ("spaghetti", "en:pastas"), ("rice", "en:rices"),
    ("bread", "en:breads"), ("yogurt", "en:yogurts"), ("yoghurt", "en:yogurts"), ("cheese", "en:cheeses"),
]


def category_match(text: str) -> tuple[str, str] | None:
    """(product word, Open Food Facts category) for the first product word in the text, else None."""
    t = (text or "").lower()
    for word, tag in CATEGORY_TAGS:
        if re.search(rf"(?<![a-z]){re.escape(word)}(?:s|es)?(?![a-z])", t):
            return word, tag
    return None


def category_tag(text: str) -> str | None:
    hit = category_match(text)
    return hit[1] if hit else None


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


_LANG_PREFIX = re.compile(r"^[a-z]{2,3}:")


def clean_brand(raw) -> str | None:
    """First brand from the brands field, without tag syntax: 'xx:al-janoub-stores' -> 'Al Janoub Stores'.

    Hyphens are only replaced in tag-style values (the ones with a language prefix), so real
    brand names such as 'Coca-Cola' keep theirs. Words are capitalised only if it is all lowercase.
    """
    if isinstance(raw, list):
        raw = ", ".join(str(b) for b in raw)
    brand = (raw or "").split(",")[0].strip()
    if _LANG_PREFIX.match(brand):
        brand = _LANG_PREFIX.sub("", brand).replace("-", " ")
    brand = " ".join(brand.split())
    if brand and brand == brand.lower():
        brand = " ".join(w[:1].upper() + w[1:] for w in brand.split())
    return brand or None


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
        "product_id": pid, "barcode": code, "name": name, "brand": clean_brand(p.get("brands")),
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
# Everything to_truevalue reads. The search server names them differently and sends lists of tags (see from_search).
SCORE_FIELDS = ("code,product_name,product_name_en,brands,brand_owner,quantity,image_front_url,image_front_small_url,"
                "countries,labels,categories,manufacturing_places,origins,environmental_score_grade,packagings")


def _tag_text(value) -> str:
    """['en:fair-trade', 'Canada'] -> 'Fair Trade, Canada'. Text stays as it is."""
    if not isinstance(value, list):
        return value or ""
    out = []
    for t in value:
        t = str(t).strip()
        if _LANG_PREFIX.match(t):
            t = _LANG_PREFIX.sub("", t).replace("-", " ").title()
        if t:
            out.append(t)
    return ", ".join(dict.fromkeys(out))


def from_search(hit: dict) -> dict:
    """A search.openfoodfacts.org hit -> the product API shape that to_truevalue reads.

    The search server sends `labels`, `categories` and `countries` as lists of tags, and places as lists.
    A hit from the classic search (already in product API shape) passes through unchanged.
    """
    if not isinstance(hit.get("labels"), list) and not isinstance(hit.get("categories"), list):
        return hit
    p = dict(hit)
    p["labels_tags"] = hit.get("labels") or []
    p["categories_tags"] = hit.get("categories") or []
    p["countries_tags"] = hit.get("countries") or []
    for key in ("labels", "countries", "manufacturing_places", "origins", "brand_owner"):
        p[key] = _tag_text(hit.get(key))
    return p


def _search_item(p: dict, in_canada: bool = False) -> dict | None:
    code = valid_barcode(str(p.get("code") or ""))
    countries = p.get("countries_tags") or (p.get("countries") if isinstance(p.get("countries"), list) else [])
    name = p.get("product_name") or p.get("product_name_en")
    if not code or not name:
        return None
    return {"barcode": code, "name": name.strip(), "brand": clean_brand(p.get("brands")),
            "quantity": p.get("quantity"), "image": p.get("image_front_small_url"),
            "sold_in_canada": in_canada or "en:canada" in countries, "source": "openfoodfacts"}


async def search(query: str, limit: int = 12, category: str | None = None, full: bool = False) -> list[dict]:
    """Real products by name. Products sold in Canada first, then the rest of the world.

    `category` (an Open Food Facts tag from category_tag) keeps results to that kind of product,
    so "canned water" finds waters. With fewer than 3 such hits the search widens without it.
    `full` adds each item's label data as `product` (product API shape), so it can be scored
    without one more request per product (the product API answers HTTP 429 to bursts).
    """
    q = " ".join(query.split())[:80]
    key = f"offsearch:{q.lower()}:{limit}:{category or ''}:{'full' if full else 'list'}"
    cached = await cache_get(key)
    if cached is not None:
        return cached
    base = "https://world.openfoodfacts.org/cgi/search.pl"
    fields = SCORE_FIELDS if full else SEARCH_FIELDS
    common = {"search_terms": q, "search_simple": 1, "action": "process", "json": 1, "page_size": limit,
              "fields": f"{FIELDS},image_front_small_url,countries_tags" if full else SEARCH_FIELDS,
              "sort_by": "unique_scans_n"}
    canada = {**common, "tagtype_0": "countries", "tag_contains_0": "contains", "tag_0": "canada"}
    # Measured from Vercel with /api/diagnostics (Oct 2026): the classic cgi/search.pl returns HTTP 503
    # (an HTML error page), while the newer search server answers in under 1 s, so it is used first.
    # Its field is `countries` (Nov 2026: `countries_tags` is rejected with HTTP 400) and `categories`.
    fast_url = "https://search.openfoodfacts.org/search"
    in_canada = f'{q} countries:"en:canada"'
    attempts = []
    if category:
        # Inside a category, the most scanned products come first: well-known brands with fuller label data
        # (Nov 2026: "water" in en:waters gave Kirkland, Eska, Naya by popularity; "Water, no brand" by relevance).
        # If the full words find too little ("canned water"), the category's own word is tried next ("water").
        popular = {"page_size": limit, "fields": fields, "sort_by": "-unique_scans_n"}
        attempts.append((fast_url, {**popular, "q": f'{in_canada} categories:"{category}"'}, "hits", True))
        word = category_match(q)
        if word and word[1] == category and word[0] != q.lower():
            attempts.append((fast_url, {**popular, "q": f'{word[0]} countries:"en:canada" categories:"{category}"'},
                             "hits", True))
    first_wide = len(attempts)
    attempts += [(fast_url, {"q": in_canada, "page_size": limit, "fields": fields}, "hits", True),
                 (fast_url, {"q": q, "page_size": limit, "fields": fields}, "hits", False),
                 (base, canada, "products", True)]
    items: list[dict] = []
    failures = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(12, connect=5), headers={"User-Agent": USER_AGENT}) as client:
        for i, (url, params, list_key, canadian) in enumerate(attempts):
            # Enough results: stop. Category results count once there are 3, so the kind of product stays right.
            if len(items) >= limit or (category and i >= first_wide and len(items) >= 3):
                break
            try:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                results = resp.json().get(list_key) or []
            except (httpx.HTTPError, ValueError) as exc:
                failures += 1
                log.warning("Open Food Facts search %s failed: %s %s", url, type(exc).__name__, exc)
                continue
            for p in results:
                item = _search_item(p, canadian)
                if item and all(i["barcode"] != item["barcode"] for i in items):
                    if full:
                        item["product"] = from_search(p)
                    items.append(item)
    if not items and failures == len(attempts):
        raise RuntimeError("Open Food Facts search unavailable")
    items = items[:limit]
    if items:  # never cache an empty answer that might just be a busy server
        await cache_set(key, items, ttl=6 * 3600)
    return items
