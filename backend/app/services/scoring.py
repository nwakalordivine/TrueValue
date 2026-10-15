"""TrueValue scoring model 1.0.0.

Python port of frontend/src/services/scoringService.js, so the web page and the
assistant always agree. Pure Python, no I/O, so it is easy to test.

Rules (same as the frontend):
- Unknown is never zero. Unknown dimensions are left out of the score but lower coverage.
- Claimed scores count, but are never presented as verified.
- Score = sum(weight x raw_score) / sum(weights of dimensions that have a score).
"""
from __future__ import annotations

from datetime import datetime, timezone

MODEL_VERSION = "1.0.0"
SCORED_STATUSES = {"Verified", "Claimed"}


def _clamp_weight(value) -> float:
    try:
        return max(0.0, min(100.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def calculate_match(product: dict, dimensions: list[dict], weights: dict, claims: list[dict]) -> dict:
    rows = []
    for d in dimensions:
        dim_id = d["dimension_id"]
        weight = _clamp_weight(weights.get(dim_id, 0))
        claim = next((c for c in claims if c.get("product_id") == product["product_id"]
                      and c.get("dimension_id") == dim_id), None)
        raw = claim.get("raw_score") if claim else None
        scored = bool(claim and claim.get("status") in SCORED_STATUSES and isinstance(raw, (int, float)))
        rows.append({
            "dimension_id": dim_id,
            "dimension": d["label"],
            "weight": weight,
            "raw_score": raw if scored else None,
            "confidence": claim.get("confidence", 0) if scored else 0,
            "coverage_percent": claim.get("coverage_percent", 0) if scored else 0,
            "status": (claim or {}).get("status") or "Unknown",
            "source_id": (claim or {}).get("source_id"),
            "claim_id": (claim or {}).get("claim_id"),
            "contribution": weight * raw if scored else None,
        })

    total_weight = sum(r["weight"] for r in rows)
    available = [r for r in rows if r["weight"] > 0 and r["raw_score"] is not None]
    denominator = sum(r["weight"] for r in available)
    covered = sum(r["weight"] * r["coverage_percent"] / 100 for r in available)
    score = round(sum(r["contribution"] for r in available) / denominator) if denominator else None
    coverage = round(covered / total_weight * 100) if total_weight else 0
    confidence = round(sum(r["weight"] * r["confidence"] for r in available) / denominator, 2) if denominator else 0
    verified_weight = sum(r["weight"] for r in rows if r["weight"] > 0 and r["status"] == "Verified")
    return {
        "product_id": product["product_id"],
        "raw_score": score,
        "confidence": confidence,
        "coverage_percent": coverage,
        "verified_percent": round(verified_weight / total_weight * 100) if total_weight else 0,
        "breakdown_json": rows,
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "model_version": MODEL_VERSION,
    }


def rank_products(products, dimensions, weights, claims):
    scored = [(p, calculate_match(p, dimensions, weights, claims)) for p in products]
    scored.sort(key=lambda t: (-(t[1]["raw_score"] if t[1]["raw_score"] is not None else -1),
                               -t[1]["coverage_percent"], t[0]["name"]))
    return scored


def lowest_price(product_id: str, prices: list[dict]):
    values = [o["price"] for o in prices if o.get("product_id") == product_id]
    return min(values) if values else None


def alternatives(product, products, dimensions, weights, claims, prices, limit=3):
    """Better-matching products, preferring the same category (doc: 'Consider instead')."""
    base = calculate_match(product, dimensions, weights, claims)["raw_score"]
    if base is None:
        return []
    own_price = lowest_price(product["product_id"], prices)
    out = []
    for p in products:
        if p["product_id"] == product["product_id"]:
            continue
        m = calculate_match(p, dimensions, weights, claims)
        if m["raw_score"] is None or m["raw_score"] <= base:
            continue
        price = lowest_price(p["product_id"], prices)
        out.append({
            "product_id": p["product_id"], "name": p["name"], "category": p["category"],
            "same_category": p["category"] == product["category"],
            "score": m["raw_score"], "score_delta": m["raw_score"] - base,
            "price": price,
            "price_delta": round(price - own_price, 2) if price is not None and own_price is not None else None,
        })
    out.sort(key=lambda a: (not a["same_category"], -a["score_delta"]))
    return out[:limit]


def verdict(product, match: dict, alts: list[dict]) -> dict:
    """The 'decision' block of the True Value Card, in plain language."""
    rows = [r for r in match["breakdown_json"] if r["weight"] > 0]
    if not rows or match["raw_score"] is None:
        return {"label": "Not enough data", "tone": "unknown",
                "sentence": "We do not have enough information on the values you weighted to score this product."}
    rows_by_weight = sorted(rows, key=lambda r: -r["weight"])
    strong = [r["dimension"] for r in rows_by_weight if r["raw_score"] is not None and r["raw_score"] >= 70]
    weak = [r["dimension"] for r in rows_by_weight if r["raw_score"] is not None and r["raw_score"] < 50]
    unknown = [r["dimension"] for r in rows_by_weight if r["raw_score"] is None]

    parts = []
    if strong:
        parts.append(f"Strong on {_join(strong[:2])}")
    if weak:
        parts.append(f"weak on {_join(weak[:2])}")
    if unknown:
        parts.append(f"nothing known about {_join(unknown[:2])}")
    sentence = (", ".join(parts) + ".") if parts else "Middle of the road on the values you weighted."
    sentence = sentence[0].upper() + sentence[1:]

    top = rows_by_weight[0]
    better_same = [a for a in alts if a["same_category"] and a["score_delta"] >= 5]
    if top["raw_score"] is None:
        label, tone = "Buy with caution", "caution"
        reason = f"Nothing is known about {top['dimension']}, your top priority."
    elif better_same:
        label, tone = "Consider instead", "consider"
        reason = f"{better_same[0]['name']} fits your values better (+{better_same[0]['score_delta']} points)."
    elif match["raw_score"] >= 65:
        label, tone = "Good fit", "good"
        reason = "It scores well on the values you weighted most."
    else:
        label, tone = "Weak fit", "caution"
        reason = "It scores low on the values you weighted."
    if match["verified_percent"] == 0:
        reason += " None of this is independently verified yet; it is based on company claims."
    elif match["verified_percent"] < 50:
        reason += f" Only {match['verified_percent']}% of this is backed by verified data; most of it is company claims."
    return {"label": label, "tone": tone, "sentence": sentence, "reason": reason}


def highlights(match: dict, limit=3) -> list[dict]:
    rows = sorted([r for r in match["breakdown_json"] if r["weight"] > 0], key=lambda r: -r["weight"])
    return [{"label": r["dimension"], "status": r["status"], "score": r["raw_score"]} for r in rows[:limit]]


def _join(items):
    return items[0] if len(items) == 1 else f"{items[0]} and {items[1]}"
