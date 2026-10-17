"""The TrueValue assistant: question in, structured and honest answer out.

Flow: parse (rules, then AI if available) -> do the real work in code (scoring, registry,
maps, recycling rules) -> write a short summary (AI if available, template otherwise).
The AI never produces scores or facts; it only understands the question and words the answer.
"""
from __future__ import annotations

import asyncio

import hashlib
import json
import logging

from app.redis_client import cache_get, cache_set
from app.services import catalog, disposal, llm, openfoodfacts, parser, places, registry, scoring

log = logging.getLogger("truevalue.assistant")
DATA_NOTE = ("Products, prices and their claims are fictional demo data. Company registry checks, store "
             "locations and recycling rules are real.")


# ---------- helpers ----------

def _weights(client_weights: dict | None, priorities: list[str]) -> dict:
    base = catalog.default_weights()
    if client_weights:
        base.update({k: v for k, v in client_weights.items() if k in base})
    if priorities:
        base = {k: (100 if k in priorities else round(float(v) / 2)) for k, v in base.items()}
    return base


def product_card(p: dict, weights: dict, extra_claims: list[dict] | None = None) -> dict:
    """True Value Card. `extra_claims` is used for products that are not in the catalog (barcode scans)."""
    c = catalog.get()
    claims = c["claims"] + (extra_claims or [])
    products = c["products"] if not extra_claims else c["products"] + [p]
    match = scoring.calculate_match(p, c["ethicalDimensions"], weights, claims)
    alts = scoring.alternatives(p, products, c["ethicalDimensions"], weights, claims, c["priceObservations"])
    chain = catalog.company_chain(p.get("company_id"))
    certs = []
    for pc in c["productCertifications"]:
        if pc["product_id"] == p["product_id"]:
            cert = next((x for x in c["certifications"] if x["certification_id"] == pc["certification_id"]), {})
            certs.append({"name": cert.get("name", pc["certification_id"]), "status": pc["status"]})
    sources = {s["source_id"]: s["name"] for s in c["dataSources"]}
    rows = sorted(match["breakdown_json"], key=lambda r: -r["weight"])
    price = scoring.lowest_price(p["product_id"], c["priceObservations"])
    return {
        "product_id": p["product_id"], "name": p["name"], "brand": p.get("brand"), "category": p.get("category"),
        "emoji": p.get("emoji"), "size": p.get("size"), "barcode": p.get("barcode"),
        "price": price,
        "score": match["raw_score"], "coverage_percent": match["coverage_percent"],
        "verified_percent": match["verified_percent"], "confidence": match["confidence"],
        "model_version": match["model_version"],
        "verdict": scoring.verdict(p, match, alts),
        "highlights": scoring.highlights(match),
        "breakdown": [{"dimension_id": r["dimension_id"], "dimension": r["dimension"], "weight": r["weight"],
                       "score": r["raw_score"], "status": r["status"], "source": sources.get(r["source_id"]),
                       "note": _note(p, r, chain, certs)}
                      for r in rows],
        "price_context": _price_context(p, price),
        "could_change": _could_change(rows),
        "alternatives": alts,
        "company_chain": [{"name": x["legal_name"], "ownership_type": x.get("ownership_type"),
                           "city": x.get("headquarters_city"), "status": x.get("ownership_status", "Unknown")}
                          for x in chain],
        "made_in": p.get("country_of_manufacture"),
        "components": p.get("country_of_origin_components", []),
        "packaging": (p.get("packaging") or {}).get("materials", []),
        "packaging_status": (p.get("packaging") or {}).get("status", "Unknown"),
        "certifications": certs,
        "demo_data": not extra_claims,
    }


def _note(p: dict, row: dict, chain: list[dict], certs: list[dict]) -> str:
    """One plain line of 'what we found' per value, for the result page."""
    dim, status = row["dimension_id"], row["status"]
    if row["raw_score"] is None:
        return "No data available. Not counted against the product."
    who = "Company says" if status == "Claimed" else ("Demo certification record:" if status == "Verified" else "")
    co = chain[0] if chain else {}
    pack = (p.get("packaging") or {}).get("materials") or []
    if dim == "canadian_ownership":
        owner = f"{co.get('ownership_type', 'unknown')}-owned" if co else "owner unknown"
        top = f", parent {chain[-1]['legal_name'].replace(' (fictional)', '')}" if len(chain) > 1 else ""
        made = p.get("country_of_manufacture")
        where = f"made in {made}" if made and made != "Unknown" else "manufacturing country unknown"
        return f"{who} {owner}{top}, {where}.".strip()
    if dim == "local_business":
        return f"{who} based in {co.get('headquarters_city', 'unknown')}, {co.get('headquarters_province', '')}.".replace(", .", ".").strip()
    if dim == "packaging":
        bins = [f"{m.lower()}: {disposal.classify(m)['label']}" for m in pack]
        return (f"{', '.join(bins)} (City of Regina rules)." if bins else f"{who} packaging details.").strip()
    if dim == "fair_trade":
        cert = next((x for x in certs if x["status"] in ("Verified", "Claimed")), None)
        return f"{cert['name']} ({cert['status'].lower()})." if cert else f"{who} fair labour practices; no certification found.".strip()
    if dim == "animal_welfare":
        return ("Certified animal welfare (demo record)." if status == "Verified"
                else "Company claims humane practices; no certification found.")
    if dim == "environment":
        return ("Environmental certification (demo record)." if status == "Verified"
                else "Company claims sustainable practices; not independently checked.")
    return f"{who} {row['dimension'].lower()}.".strip()


def _price_context(p: dict, price: float | None) -> dict | None:
    if price is None:
        return None
    c = catalog.get()
    same = [scoring.lowest_price(x["product_id"], c["priceObservations"]) for x in c["products"]
            if x.get("category") == p.get("category")]
    same = [v for v in same if v is not None]
    avg = sum(same) / len(same) if same else None
    cheapest = min((o for o in c["priceObservations"] if o["product_id"] == p["product_id"]), key=lambda o: o["price"])
    retailer = next((r["name"] for r in c["retailers"] if r["retailer_id"] == cheapest["retailer_id"]), None)
    pct = round((price - avg) / avg * 100) if avg else None
    return {"price": price, "retailer": retailer, "category_average": round(avg, 2) if avg else None,
            "vs_average_percent": pct, "category_count": len(same)}


def _could_change(rows: list[dict]) -> str | None:
    weighted = [r for r in rows if r["weight"] > 0]
    unknown = [r["dimension"].lower() for r in weighted if r["raw_score"] is None]
    claimed = [r["dimension"].lower() for r in weighted if r["status"] == "Claimed"]
    if unknown:
        return f"Score could change if the company publishes evidence on {' and '.join(unknown[:2])}."
    if claimed:
        return f"Score could change once {' and '.join(claimed[:2])} claims are independently verified."
    return None


def _filter(products: list[dict], parsed: dict, prices: list[dict]) -> tuple[list[dict], list[str]]:
    notes = []
    pool = products
    if parsed["category"]:
        in_cat = [p for p in pool if p["category"] == parsed["category"]]
        if in_cat:
            pool = in_cat
        else:
            notes.append(f"We have no {parsed['category'].lower()} products in the demo catalog yet.")
    if parsed["max_price"] is not None:
        cheap = [p for p in pool if (scoring.lowest_price(p["product_id"], prices) or 1e9) <= parsed["max_price"]]
        if cheap:
            pool = cheap
        else:
            notes.append(f"Nothing matched under ${parsed['max_price']:.2f}, so these are the closest options.")
    return pool, notes


def _location(loc: dict | None) -> dict:
    if loc and isinstance(loc.get("lat"), (int, float)) and isinstance(loc.get("lon"), (int, float)):
        return {"lat": float(loc["lat"]), "lon": float(loc["lon"]), "source": "browser"}
    lat, lon = places.REGINA_CENTRE
    return {"lat": lat, "lon": lon, "source": "default"}


def verified_line(pct: int) -> str:
    if pct <= 0:
        return "None of its data is independently verified yet: it is company claims or unknown."
    return f"Only {pct}% of its data is verified; the rest is company claims or unknown."


def _dim_labels(ids: list[str]) -> list[str]:
    labels = {d["dimension_id"]: d["label"] for d in catalog.get()["ethicalDimensions"]}
    return [labels.get(i, i) for i in ids]



async def answer(message: str, client_weights: dict | None, location: dict | None) -> dict:
    c = catalog.get()
    rule = parser.rule_parse(message, c["products"])
    parsed = rule
    if llm.enabled() and rule["intent"] not in ("barcode", "dispose", "help"):
        key = "parse:" + hashlib.sha1(message.lower().strip().encode()).hexdigest()
        ai = await cache_get(key)
        if ai is None:
            ai = await llm.complete_json(parser.LLM_SYSTEM, parser.llm_user_prompt(message, c["products"]), budget=12)
            if ai:
                await cache_set(key, ai, ttl=3600)
        parsed = parser.merge_llm(rule, ai, c["products"])

    weights = _weights(client_weights, parsed["priorities"])
    out = {"intent": parsed["intent"], "parsed_by": parsed["parsed_by"], "message": message,
           "applied": {"priorities": _dim_labels(parsed["priorities"]), "max_price": parsed["max_price"],
                       "category": parsed["category"]},
           "products": [], "comparison": None, "companies": [], "catalog_companies": [], "registry_note": None,
           "disposal": None, "places": None, "scan": None, "suggestions": [], "notes": [], "data_note": DATA_NOTE}

    handler = HANDLERS.get(parsed["intent"], _recommend)
    await handler(out, parsed, weights, location)
    template = out.pop("_template", "")
    out["summary"], out["ai_summary"] = await _summarize(message, out, template)
    return out



async def _recommend(out, parsed, weights, location):
    c = catalog.get()
    if parsed["product_ids"]:
        pool = [catalog.product_by_id(i) for i in parsed["product_ids"]]
        notes = []
    else:
        pool, notes = _filter(c["products"], parsed, c["priceObservations"])
    ranked = scoring.rank_products(pool, c["ethicalDimensions"], weights, c["claims"])[:3]
    out["products"] = [product_card(p, weights) for p, _ in ranked]
    out["notes"] += notes
    if out["products"]:
        best = out["products"][0]
        pris = out["applied"]["priorities"]
        pri = (", ".join(pris[:-1]) + " and " + pris[-1]) if len(pris) > 1 else (pris[0] if pris else "your saved priorities")
        out["_template"] = (f"Based on {pri}, {best['name']} is the best fit at {best['score']}/100 "
                            f"({best['verdict']['label'].lower()}). {best['verdict']['sentence']} "
                            + verified_line(best["verified_percent"]))
        out["suggestions"] = [f"Where can I buy {best['name']}?", f"How do I dispose of {best['name']}?",
                              f"Why did {best['name']} get its score?"]
    else:
        out["_template"] = "I couldn't find matching products in the demo catalog."


async def _compare(out, parsed, weights, location):
    c = catalog.get()
    ids = parsed["product_ids"][:3]
    if len(ids) < 2:
        pool, notes = _filter(c["products"], parsed, c["priceObservations"])
        out["notes"] += notes
        ids = [p["product_id"] for p, _ in scoring.rank_products(pool, c["ethicalDimensions"], weights, c["claims"])[:3]]
    cards = [product_card(catalog.product_by_id(i), weights) for i in ids]
    cards.sort(key=lambda x: -(x["score"] if x["score"] is not None else -1))
    out["products"] = cards
    dims = [r["dimension"] for r in cards[0]["breakdown"]] if cards else []
    out["comparison"] = {"products": [x["name"] for x in cards], "rows": [
        {"dimension": d, "cells": [next(({"score": r["score"], "status": r["status"]} for r in x["breakdown"]
                                         if r["dimension"] == d), None) for x in cards]} for d in dims]}
    if len(cards) >= 2:
        a, b = cards[0], cards[1]
        diff = (a["score"] or 0) - (b["score"] or 0)
        price = ""
        if a["price"] is not None and b["price"] is not None:
            d = a["price"] - b["price"]
            price = f" It costs ${abs(d):.2f} {'more' if d > 0 else 'less'}."
        out["_template"] = (f"{a['name']} fits your values better than {b['name']} ({a['score']} vs {b['score']}, "
                            f"+{diff} points).{price} {a['verdict']['sentence']}")
        out["suggestions"] = [f"Where can I buy {a['name']}?", f"Why did {b['name']} score lower?"]
    else:
        out["_template"] = "I need at least two products to compare. Try naming two products."


async def _explain(out, parsed, weights, location):
    if not parsed["product_ids"]:
        return await _recommend(out, parsed, weights, location)
    card = product_card(catalog.product_by_id(parsed["product_ids"][0]), weights)
    out["products"] = [card]
    known = [r for r in card["breakdown"] if r["weight"] > 0 and r["score"] is not None]
    unknown = [r["dimension"] for r in card["breakdown"] if r["weight"] > 0 and r["score"] is None]
    top = ", ".join(f"{r['dimension']} {r['score']} ({r['status'].lower()})" for r in known[:3])
    out["_template"] = (f"{card['name']} scores {card['score']}/100 for you. Your top-weighted values: {top}. "
                        + (f"Nothing is known about {', '.join(unknown)}, so it is left out of the score, "
                           f"not counted as zero. " if unknown else "")
                        + f"Verdict: {card['verdict']['label']}. {card['verdict']['reason']}")
    if card["alternatives"]:
        alt = card["alternatives"][0]
        out["suggestions"].append(f"Compare {card['name']} and {alt['name']}")
    out["suggestions"].append(f"How do I dispose of {card['name']}?")


async def _where_to_buy(out, parsed, weights, location):
    c = catalog.get()
    loc = _location(location)
    product = catalog.product_by_id(parsed["product_ids"][0]) if parsed["product_ids"] else None
    category = product["category"] if product else parsed["category"]
    if product:
        out["products"] = [product_card(product, weights)]
    try:
        stores = await asyncio.wait_for(places.nearest_stores(loc["lat"], loc["lon"], category), timeout=22)
        error = None
    except Exception as exc:  # noqa: BLE001
        log.warning("store search failed: %s", exc)
        stores, error = [], "Map data is unavailable right now. Try again in a minute."
    demo_prices = []
    if product:
        retailers = {r["retailer_id"]: r["name"] for r in c["retailers"]}
        demo_prices = [{"retailer": retailers.get(o["retailer_id"], o["retailer_id"]), "price": o["price"]}
                       for o in c["priceObservations"] if o["product_id"] == product["product_id"]]
    out["places"] = {"kind": "stores", "items": stores, "location": loc, "error": error, "demo_prices": demo_prices,
                     "note": "Real stores from OpenStreetMap that sell this kind of product. "
                             "We cannot confirm a specific product is in stock."}
    what = category.lower() if category else "groceries"
    where = "you" if loc["source"] == "browser" else "downtown Regina (location not shared)"
    if stores:
        s = stores[0]
        lead = f"{product['name']} is demo data, so no real store stocks it. " if product else ""
        out["_template"] = (f"{lead}The closest store to {where} that sells {what} is {s['name']}, "
                            f"{s['distance_km']} km away. Stock is not confirmed, so call ahead.")
    else:
        out["_template"] = error or f"I couldn't find stores near {where}."
    if loc["source"] == "default":
        out["notes"].append("Share your location for distances from where you are.")


async def _dispose(out, parsed, weights, location):
    loc = _location(location)
    product = catalog.product_by_id(parsed["product_ids"][0]) if parsed["product_ids"] else None
    if product:
        guide = disposal.guidance_for_product(product)
    elif parsed["materials"]:
        guide = disposal.guidance_for_materials(parsed["materials"])
    else:
        guide = None
    out["disposal"] = guide
    if guide is None or guide["needs_drop_off"]:
        try:
            spots = await asyncio.wait_for(places.nearest_drop_offs(loc["lat"], loc["lon"]), timeout=22)
            error = None
        except Exception as exc:  # noqa: BLE001
            log.warning("drop-off search failed: %s", exc)
            spots, error = [], "Map data is unavailable right now. Use the SARCAN link instead."
        out["places"] = {"kind": "drop_offs", "items": spots, "location": loc, "error": error, "demo_prices": [],
                         "note": "Real recycling drop-off points from OpenStreetMap."}
    if guide:
        lead = f"For {guide['product_name']}: " if guide["product_name"] else ""
        status = (f" Note: the packaging materials are {guide['materials_status'].lower()} demo data."
                  if guide["product_name"] else "")
        tail = ""
        if out["places"] and out["places"]["items"]:
            s = out["places"]["items"][0]
            tail = f" Nearest drop-off: {s['name']}, {s['distance_km']} km away."
        out["_template"] = lead + guide["summary"] + tail + status
    else:
        out["_template"] = ("Tell me the product or material (for example 'glass jar' or 'chip bag') and I'll tell you "
                            "which Regina bin it goes in.")
        out["suggestions"] = ["Where do I recycle a glass jar?", "How do I dispose of Prairie Pulse Lentil Chips?"]


async def _company_check(out, parsed, weights, location):
    name = parsed.get("company_name")
    if not name:
        out["_template"] = "Which company should I check? For example: 'Is Loblaw a Canadian company?'"
        return
    result = await registry.search_companies(name)
    out["companies"] = result["items"]
    out["registry_note"] = result.get("note")
    norm = registry.normalize_name(name)
    out["catalog_companies"] = [
        {"name": x["legal_name"], "ownership_type": x.get("ownership_type"), "status": x.get("ownership_status"),
         "city": x.get("headquarters_city")}
        for x in catalog.get()["companies"]
        if norm and (norm in registry.normalize_name(x["legal_name"])
                     or any(norm in registry.normalize_name(b) for b in x.get("brand_names", [])))]
    if result["items"]:
        top = result["items"][0]
        qual = {"exact": "an exact match", "contains": "a name match", "similar": "a possible match"}[top["match_type"]]
        office = top["facts"]["registered_office"]["value"] or "Canada"
        warn = f" Registry status: {top['status_detail']}." if top.get("status_detail") else ""
        out["_template"] = (f"I found {qual} in the federal registry: {top['name']}, registered office in {office}, "
                            f"incorporated {top['incorporated_on'] or 'date unknown'}.{warn} "
                            f"That confirms a federally registered Canadian corporation, but not who owns it. "
                            f"Ownership stays Unknown.")
    elif result.get("error"):
        out["_template"] = result["note"]
    else:
        out["_template"] = (f"{name} is not in the federal registry of active corporations. It may be incorporated "
                            f"provincially or under another name, so this is Unknown, not 'not Canadian'.")
    if out["catalog_companies"]:
        cc = out["catalog_companies"][0]
        out["_template"] += f" In our demo catalog, {cc['name']} says it is {cc['ownership_type']}-owned (a claim)."


async def _help(out, parsed, weights, location):
    out["_template"] = ("I'm the TrueValue assistant. I can find products that fit your values, explain scores, "
                        "compare products, check if a company is federally registered in Canada, find stores near you, "
                        "and tell you which Regina bin your packaging goes in.")
    out["suggestions"] = ["Canadian coffee under $15 with less plastic", "Is Loblaw a Canadian company?",
                          "Compare Prairie Morning Coffee and Everyday Ground Coffee", "Where do I recycle a glass jar?"]


async def lookup_barcode(code: str, weights: dict) -> dict:
    """Demo catalog first, then the real Open Food Facts database."""
    barcode = openfoodfacts.valid_barcode(code)
    if not barcode:
        return {"found": False, "barcode": code, "error": "Enter a valid 8 to 14 digit barcode."}
    demo = next((p for p in catalog.get()["products"] if p.get("barcode") == barcode), None)
    if demo:
        return {"found": True, "barcode": barcode, "source": "demo", "card": product_card(demo, weights),
                "facts": None, "registry": None, "disposal": disposal.guidance_for_product(demo)}
    try:
        raw = await openfoodfacts.fetch(barcode)
    except Exception as exc:  # noqa: BLE001
        log.warning("Open Food Facts lookup failed: %s", exc)
        return {"found": False, "barcode": barcode, "error": "Open Food Facts is unavailable right now. Try again shortly."}
    if not raw:
        return {"found": False, "barcode": barcode,
                "error": "This barcode is not in Open Food Facts yet. Unknown is not bad: there's just no data."}
    product, claims, facts = openfoodfacts.to_truevalue(raw)
    card = product_card(product, weights, extra_claims=claims)
    reasons = facts["reasons"]
    for row in card["breakdown"]:
        row["note"] = reasons.get(row["dimension_id"])
        if row["source"] is None:
            row["source"] = "Open Food Facts (community data, label claims)"
    owner = facts.get("brand_owner") or product.get("brand")
    reg = None
    if owner:
        res = await registry.search_companies(owner, limit=1)
        hit = res["items"][0] if res["items"] else None
        reg = {"query": owner, "match": hit if hit and hit["match_type"] in ("exact", "contains") else None,
               "possible": hit if hit and hit["match_type"] == "similar" else None,
               "note": res.get("note"), "error": res.get("error")}
    return {"found": True, "barcode": barcode, "source": "openfoodfacts", "card": card, "facts": facts,
            "registry": reg, "disposal": disposal.guidance_for_product(product)}


async def _barcode(out, parsed, weights, location):
    res = await lookup_barcode(parsed["barcode"], weights)
    out["scan"] = res
    if not res["found"]:
        out["_template"] = res["error"]
        return
    card = res["card"]
    src = "our demo catalog" if res["source"] == "demo" else "Open Food Facts (real product, label and community data)"
    out["_template"] = (f"Barcode {res['barcode']} is {card['name']}, from {src}. It scores {card['score'] if card['score'] is not None else 'N/A'}/100 "
                        f"for your values ({card['verdict']['label'].lower()}). {card['verdict']['sentence']}")
    if res.get("registry") and res["registry"].get("match"):
        m = res["registry"]["match"]
        out["_template"] += f" Its owner name matches {m['name']} in the federal registry (registration only, not ownership)."
    out["suggestions"] = [f"Where can I buy {card['category'].lower() if card['category'] else 'groceries'} near me?"]


HANDLERS = {"recommend": _recommend, "compare": _compare, "explain": _explain, "where_to_buy": _where_to_buy,
            "dispose": _dispose, "company_check": _company_check, "help": _help, "barcode": _barcode}



SUMMARY_SYSTEM = """You write the reply for TrueValue, an honest ethical shopping assistant in Regina, Canada.
You get the shopper's question and FACTS computed by the app. Write 1 to 3 short, friendly sentences in plain
English that answer the question using ONLY the facts. Rules: never invent products, scores, prices, companies,
places or certifications; say when data is only a company claim or unknown; unknown never means bad;
federal registration never proves Canadian ownership; do not mention JSON or 'facts'.
Return ONLY a JSON object: {"summary": "..."}"""


def _facts_for_llm(out: dict, template: str) -> dict:
    return {
        "intent": out["intent"],
        "draft_answer": template,
        "products": [{k: p[k] for k in ("name", "score", "price", "verified_percent")} | {
            "verdict": p["verdict"]["label"], "why": p["verdict"]["sentence"]} for p in out["products"]],
        "companies": [{"name": x["name"], "match": x["match_type"], "office": x["facts"]["registered_office"]["value"],
                       "status_detail": x["status_detail"]} for x in out["companies"][:3]],
        "places": [{"name": s["name"], "km": s["distance_km"]} for s in (out["places"] or {}).get("items", [])[:3]],
        "disposal": (out["disposal"] or {}).get("summary"),
        "notes": out["notes"],
    }


async def _summarize(message: str, out: dict, template: str) -> tuple[str, bool]:
    if not llm.enabled() or out["intent"] == "help":
        return template, False
    facts = _facts_for_llm(out, template)
    ai = await llm.complete_json(SUMMARY_SYSTEM, f"Question: {message}\nFACTS: {json.dumps(facts)}", max_tokens=250, budget=12)
    text = (ai or {}).get("summary")
    if not isinstance(text, str) or not (20 <= len(text) <= 700):
        return template, False
    # Guard: the AI may not name catalog products that are not in this answer
    allowed = {p["name"].lower() for p in out["products"]}
    for p in catalog.get()["products"]:
        if p["name"].lower() in text.lower() and p["name"].lower() not in allowed:
            return template, False
    return text.strip(), True
