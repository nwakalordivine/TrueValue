"""Real nearby places from OpenStreetMap (Overpass API).

- Stores that sell a product category (we never claim a specific product is in stock).
- Recycling drop-off points: SARCAN depots and recycling centres/containers.

Results are cached in Redis by rounded location so the demo stays fast and we
don't hammer the free Overpass servers.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math

import httpx

from app.redis_client import cache_get, cache_set

log = logging.getLogger("truevalue.places")

REGINA_CENTRE = (50.4452, -104.6189)  # City Hall, used when the browser gives no location
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "TrueValue/1.0 (Tech Skills Showcase 2026 demo)"

# Which OSM shop types plausibly sell each demo category
CATEGORY_SHOPS = {
    "Coffee": ["supermarket", "convenience", "coffee", "greengrocer", "health_food"],
    "Beverages": ["supermarket", "convenience", "beverages"],
    "Chocolate": ["supermarket", "convenience", "confectionery", "chocolate"],
    "Spreads": ["supermarket", "convenience", "health_food", "greengrocer"],
    "Snacks": ["supermarket", "convenience"],
    "Breakfast": ["supermarket", "convenience", "health_food"],
}
DEFAULT_SHOPS = ["supermarket", "convenience", "greengrocer", "health_food"]


def haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a_lat), math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def directions_url(from_lat, from_lon, to_lat, to_lon) -> str:
    return (f"https://www.openstreetmap.org/directions?engine=fossgis_osrm_car"
            f"&route={from_lat:.5f}%2C{from_lon:.5f}%3B{to_lat:.5f}%2C{to_lon:.5f}")


async def _overpass(query: str) -> list[dict]:
    key = "osm:" + hashlib.sha1(query.encode()).hexdigest()
    cached = await cache_get(key)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=httpx.Timeout(18, connect=6), headers={"User-Agent": USER_AGENT}) as client:
        for url in OVERPASS_URLS:
            try:
                resp = await client.post(url, data={"data": query})
                if resp.status_code == 200:
                    elements = resp.json().get("elements", [])
                    await cache_set(key, elements, ttl=6 * 3600)
                    return elements
                log.warning("Overpass %s returned HTTP %s", url, resp.status_code)
            except (httpx.HTTPError, json.JSONDecodeError) as exc:
                log.warning("Overpass %s failed: %s %s", url, type(exc).__name__, exc)
    raise RuntimeError("All Overpass servers failed")


async def _nominatim(terms: list[str], lat: float, lon: float, box: float = 0.12) -> list[dict]:
    """Fallback when every Overpass server is busy: Nominatim search inside a box around the user.
    Returns elements shaped like Overpass results so the same code can read them."""
    key = f"nom:{'|'.join(terms)}:{lat}:{lon}:{box}"
    cached = await cache_get(key)
    if cached is not None:
        return cached
    out, seen = [], set()
    viewbox = f"{lon - box * 1.5},{lat + box},{lon + box * 1.5},{lat - box}"
    async with httpx.AsyncClient(timeout=12, headers={"User-Agent": USER_AGENT}) as client:
        for term in terms:
            try:
                resp = await client.get(NOMINATIM_URL, params={"q": term, "format": "jsonv2", "limit": 25,
                                                               "viewbox": viewbox, "bounded": 1, "addressdetails": 1})
                if resp.status_code != 200:
                    log.warning("Nominatim returned HTTP %s", resp.status_code)
                    continue
                for r in resp.json():
                    if r["osm_id"] in seen:
                        continue
                    seen.add(r["osm_id"])
                    a = r.get("address", {})
                    out.append({"type": r.get("osm_type", "node"), "id": r["osm_id"],
                                "lat": float(r["lat"]), "lon": float(r["lon"]),
                                "tags": {"name": r.get("name") or r.get("display_name", "").split(",")[0],
                                         "shop": r.get("type"), "amenity": r.get("category"),
                                         "addr:housenumber": a.get("house_number"), "addr:street": a.get("road"),
                                         "addr:city": a.get("city")}})
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("Nominatim failed: %s %s", type(exc).__name__, exc)
    if not out:
        raise RuntimeError("Map services unavailable")
    await cache_set(key, out, ttl=6 * 3600)
    return out


def _coords(el) -> tuple[float, float] | None:
    if "lat" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else None


def _address(tags: dict) -> str | None:
    street = " ".join(x for x in [tags.get("addr:housenumber"), tags.get("addr:street")] if x)
    city = tags.get("addr:city")
    return ", ".join(x for x in [street, city] if x) or None


def _round(v: float) -> float:
    return round(v, 3)  # ~100 m, good for caching and privacy


async def nearest_stores(lat: float, lon: float, category: str | None = None, limit: int = 6) -> list[dict]:
    lat, lon = _round(lat), _round(lon)
    shops = CATEGORY_SHOPS.get(category or "", DEFAULT_SHOPS)
    pattern = "|".join(shops)
    for radius in (4000, 12000):
        query = (f'[out:json][timeout:20];(node["shop"~"^({pattern})$"](around:{radius},{lat},{lon});'
                 f'way["shop"~"^({pattern})$"](around:{radius},{lat},{lon}););out center 80;')
        try:
            elements = await _overpass(query)
        except RuntimeError:
            terms = ["supermarket", "grocery"] + (["convenience store"] if "convenience" in shops else [])
            elements = await _nominatim(terms, lat, lon)
            radius = 12000  # no second pass with the fallback
        items = []
        for el in elements:
            tags = el.get("tags", {})
            pos = _coords(el)
            if not pos or not tags.get("name"):
                continue
            dist = haversine_km(lat, lon, *pos)
            items.append({
                "osm_id": f"{el['type']}/{el['id']}", "name": tags["name"], "kind": tags.get("shop"),
                "brand": tags.get("brand"), "address": _address(tags), "opening_hours": tags.get("opening_hours"),
                "lat": pos[0], "lon": pos[1], "distance_km": round(dist, 2),
                "directions_url": directions_url(lat, lon, *pos),
                "osm_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
                "stock_status": "Unknown",
            })
        items.sort(key=lambda x: x["distance_km"])
        # prefer variety over five branches of the same chain in a row
        if len(items) >= 3 or radius == 12000:
            return _dedupe(items)[:limit]
    return []


async def nearest_drop_offs(lat: float, lon: float, limit: int = 6) -> list[dict]:
    lat, lon = _round(lat), _round(lon)
    radius = 15000
    query = (f'[out:json][timeout:20];('
             f'node["name"~"SARCAN",i](around:{radius},{lat},{lon});'
             f'way["name"~"SARCAN",i](around:{radius},{lat},{lon});'
             f'node["amenity"="recycling"](around:{radius},{lat},{lon});'
             f'way["amenity"="recycling"](around:{radius},{lat},{lon});'
             f');out center 120;')
    try:
        elements = await _overpass(query)
    except RuntimeError:
        elements = await _nominatim(["SARCAN", "recycling depot", "recycling"], lat, lon, box=0.15)
        for el in elements:  # Nominatim results have no recycling tags; mark the obvious ones
            if "sarcan" not in el["tags"]["name"].lower():
                el["tags"]["amenity"] = "recycling"
    items = []
    for el in elements:
        tags = el.get("tags", {})
        pos = _coords(el)
        if not pos:
            continue
        name = tags.get("name") or tags.get("operator") or "Recycling drop-off"
        is_sarcan = "sarcan" in (name + " " + tags.get("operator", "")).lower()
        accepts = sorted(k.split(":", 1)[1].replace("_", " ") for k, v in tags.items()
                         if k.startswith("recycling:") and v == "yes")
        kind = "SARCAN depot" if is_sarcan else (
            "Recycling centre" if tags.get("recycling_type") == "centre" else "Recycling container")
        items.append({
            "osm_id": f"{el['type']}/{el['id']}", "name": name, "kind": kind, "is_sarcan": is_sarcan,
            "accepts": accepts[:8], "address": _address(tags), "opening_hours": tags.get("opening_hours"),
            "lat": pos[0], "lon": pos[1], "distance_km": round(haversine_km(lat, lon, *pos), 2),
            "directions_url": directions_url(lat, lon, *pos),
            "osm_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
        })
    # SARCAN depots first (they take glass, flexible plastics and deposit containers), then by distance
    items.sort(key=lambda x: (not x["is_sarcan"], x["distance_km"]))
    sarcan = [i for i in items if i["is_sarcan"]][:3]
    others = sorted([i for i in items if not i["is_sarcan"]], key=lambda x: x["distance_km"])
    return (sarcan + _dedupe(others))[:limit]


def _dedupe(items: list[dict]) -> list[dict]:
    seen, out = set(), []
    for i in items:
        key = (i["name"].lower(), round(i["lat"], 3), round(i["lon"], 3))
        if key in seen:
            continue
        seen.add(key)
        out.append(i)
    return out
