"""Turn a shopper's question into a structured request.

`rule_parse` works with no AI at all (keywords and regex), so the assistant still works
when OpenRouter is down or out of free requests. `merge_llm` accepts an AI parse only
after validating every field against the real catalog. Pure Python, no I/O.
"""
from __future__ import annotations

import re

INTENTS = ["recommend", "compare", "explain", "where_to_buy", "dispose", "company_check", "help"]

PRIORITY_WORDS = {
    "canadian_ownership": ["canadian", "canada", "buy canadian", "made in canada", "maple"],
    "local_business": ["local", "regina", "saskatchewan", "sask", "nearby business", "small business"],
    "fair_trade": ["fair trade", "fairtrade", "fair labour", "fair labor", "workers", "ethical labour", "child labour"],
    "animal_welfare": ["animal", "cruelty", "vegan", "humane", "cage-free", "cage free"],
    "environment": ["environment", "eco", "climate", "carbon", "green", "organic", "sustainab"],
    "packaging": ["plastic", "packaging", "waste", "recycl", "zero waste", "low-waste", "low waste"],
}

CATEGORY_WORDS = {
    "Coffee": ["coffee", "espresso", "beans"],
    "Beverages": ["drink", "beverage", "water", "oat milk", "milk", "juice", "soda", "sparkling"],
    "Breakfast": ["granola", "cereal", "breakfast", "oats", "oat bites"],
    "Spreads": ["peanut butter", "spread", "honey", "jam", "hazelnut", "nut butter"],
    "Chocolate": ["chocolate", "cocoa", "candy"],
    "Snacks": ["snack", "chips", "crisps"],
}

MATERIAL_WORDS = ["glass", "jar", "plastic bag", "bag", "can", "carton", "cardboard", "box", "paper", "foil",
                  "pouch", "bottle", "lid", "foam", "styrofoam", "wrapper", "coffee pod"]

INTENT_PATTERNS = [
    ("dispose", r"\b(dispose|disposal|recycle|recycling|throw (it |this )?(away|out)|which bin|what bin|"
                r"blue cart|garbage|trash|sarcan|get rid of)\b"),
    ("company_check", r"\b(who owns|owned by|is .{2,60}? (a )?canadian (company|business|owned)|registered|"
                      r"registry|incorporated|check (the )?company|is .{2,60}? canadian\??$)"),
    ("where_to_buy", r"\b(where (can|do|should) i (buy|get|find)|where to (buy|get|find)|nearest|near me|nearby store|"
                     r"closest|which store|stores? (near|close))\b"),
    ("compare", r"\b(compare|comparison|versus|vs\.?|better than|difference between)\b"),
    ("explain", r"\b(why|explain|how (was|is) (the |its )?score|score breakdown|how did you)\b"),
    ("help", r"^(hi|hello|hey|help|what can you do)\b"),
]


def _contains(text: str, word: str) -> bool:
    return re.search(r"(?<![a-z])" + re.escape(word), text) is not None


def find_products(text: str, products: list[dict]) -> list[str]:
    """Product ids mentioned by name, brand+distinct word, or barcode, in order of appearance."""
    t = text.lower()
    hits = []
    for p in products:
        name = p["name"].lower()
        pos = t.find(name)
        if pos < 0 and p.get("barcode") and p["barcode"] in t:
            pos = t.find(p["barcode"])
        if pos < 0:
            # brand + a distinctive word of the product name ("everyday instant", "prairie morning oat")
            brand = (p.get("brand") or "").lower()
            generic = {w for words in CATEGORY_WORDS.values() for phrase in words for w in phrase.split()}
            rest = [w for w in name.replace(brand, "").split() if len(w) > 3 and w not in generic]
            if brand and brand in t and any(_contains(t, w) for w in rest):
                pos = t.find(brand)
        if pos >= 0:
            hits.append((pos, p["product_id"]))
    hits.sort()
    return [pid for _, pid in hits]


def _category(text: str) -> str | None:
    for cat, words in CATEGORY_WORDS.items():
        if any(_contains(text, w) for w in words):
            return cat
    return None


def _company_name(message: str) -> str | None:
    m = message.strip().rstrip("?.! ")
    patterns = [
        r"who owns (?:the )?(.+)",
        r"(?:is|are) (.+?) (?:a |an )?(?:canadian|registered|incorporated|federally)",
        r"(?:check|look up|lookup|search)(?: the)?(?: company| business)? (.+)",
        r"(.+?) (?:is it )?(?:canadian|registered)",
        r"owned by (.+)",
    ]
    for pat in patterns:
        hit = re.search(pat, m, re.IGNORECASE)
        if hit:
            name = re.sub(r"\b(company|business|brand|the|really|actually|owned)\b", " ", hit.group(1), flags=re.IGNORECASE)
            name = re.sub(r"\s+", " ", name).strip(" '\"")
            if 1 < len(name) <= 80:
                return name
    return None


MATERIAL_ADJ = ["glass", "plastic", "metal", "aluminum", "aluminium", "paper", "foil", "foam", "flexible", "chip", "tin"]
MATERIAL_NOUN = ["jar", "bag", "can", "carton", "cardboard", "box", "paper", "foil", "pouch", "bottle", "lid", "foam",
                 "styrofoam", "wrapper", "wrap", "coffee pod", "pod", "container", "tub", "glass"]


def _materials(text: str) -> list[str]:
    """'a glass jar and a chip bag' -> ['glass jar', 'chip bag']"""
    adj, noun = "|".join(MATERIAL_ADJ), "|".join(sorted(MATERIAL_NOUN, key=len, reverse=True))
    found = re.findall(rf"\b((?:(?:{adj})\s+)?(?:{noun}))s?\b", text)
    return list(dict.fromkeys(f.strip() for f in found))


def rule_parse(message: str, products: list[dict]) -> dict:
    t = message.lower().strip()
    # A barcode typed or scanned (8, 12, 13 or 14 digits) -> look it up
    code = re.search(r"(?<!\d)(\d{8}|\d{12,14})(?!\d)", t.replace(" ", "") if re.fullmatch(r"[\d ]{8,20}", t) else t)
    if code:
        return {"intent": "barcode", "barcode": code.group(1), "product_ids": [], "category": None, "priorities": [],
                "max_price": None, "company_name": None, "materials": [], "parsed_by": "rules"}
    intent = "recommend"
    for name, pattern in INTENT_PATTERNS:
        if re.search(pattern, t):
            intent = name
            break
    product_ids = find_products(t, products)
    if intent == "recommend" and len(product_ids) >= 2 and re.search(r"\b(or|and)\b", t):
        intent = "compare"
    if intent == "recommend" and len(product_ids) == 1 and re.search(r"\b(score|rating|good|ethical|fit)\b", t):
        intent = "explain"

    priorities = [dim for dim, words in PRIORITY_WORDS.items() if any(w in t for w in words)]
    if intent in ("dispose", "where_to_buy"):
        priorities = []  # "recycle" in a disposal question is not a shopping priority
    price = re.search(r"(?:under|below|less than|max(?:imum)?|cheaper than|up to|<)\s*\$?\s*(\d+(?:\.\d{1,2})?)", t)
    materials = _materials(t) if intent == "dispose" else []
    return {
        "intent": intent,
        "product_ids": product_ids,
        "category": _category(t),
        "priorities": priorities,
        "max_price": float(price.group(1)) if price else None,
        "company_name": _company_name(message) if intent == "company_check" else None,
        "materials": materials,
        "parsed_by": "rules",
    }


LLM_SYSTEM = """You turn a shopper's question into JSON for the TrueValue shopping assistant in Regina, Canada.
Return ONLY a JSON object with these keys:
- "intent": one of recommend, compare, explain, where_to_buy, dispose, company_check, help
  (recommend = find products that fit values; explain = why a product got its score;
   dispose = how/where to recycle or throw away packaging; company_check = is a company Canadian/registered/who owns it)
- "product_names": list of product names from the catalog that the user mentions (exact names from the list), else []
- "category": one of Coffee, Beverages, Breakfast, Spreads, Chocolate, Snacks, or null
- "priorities": list from canadian_ownership, local_business, fair_trade, animal_welfare, environment, packaging
  that the user explicitly cares about in THIS message, else []
- "max_price": number in CAD if the user gives a price limit, else null
- "company_name": the company name for company_check, else null
- "materials": packaging materials mentioned for dispose (e.g. "glass jar"), else []
Never invent products. If unsure, use intent "recommend"."""


def llm_user_prompt(message: str, products: list[dict]) -> str:
    names = "; ".join(f"{p['name']} ({p['category']})" for p in products)
    return f"Catalog: {names}\n\nShopper: {message}"


def merge_llm(rule: dict, llm: dict | None, products: list[dict]) -> dict:
    """Validate the AI parse field by field; anything invalid falls back to the rule parse."""
    if not isinstance(llm, dict):
        return rule
    out = dict(rule)
    if llm.get("intent") in INTENTS:
        out["intent"] = llm["intent"]
    by_name = {p["name"].lower(): p["product_id"] for p in products}
    ids = [by_name[n.lower()] for n in llm.get("product_names") or [] if isinstance(n, str) and n.lower() in by_name]
    if ids:
        out["product_ids"] = list(dict.fromkeys(ids + rule["product_ids"]))
    if llm.get("category") in CATEGORY_WORDS:
        out["category"] = llm["category"]
    pri = [p for p in llm.get("priorities") or [] if p in PRIORITY_WORDS]
    if pri or rule["priorities"]:
        out["priorities"] = list(dict.fromkeys(rule["priorities"] + pri))
    if isinstance(llm.get("max_price"), (int, float)) and 0 < llm["max_price"] < 1000:
        out["max_price"] = float(llm["max_price"])
    if out["intent"] == "company_check" and isinstance(llm.get("company_name"), str) and llm["company_name"].strip():
        out["company_name"] = llm["company_name"].strip()[:80]
    if out["intent"] == "dispose" and isinstance(llm.get("materials"), list):
        mats = [m for m in llm["materials"] if isinstance(m, str) and 1 < len(m) < 40]
        out["materials"] = mats or rule["materials"]
    out["parsed_by"] = "ai"
    return out
