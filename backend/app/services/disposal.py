"""Where does each packaging material go in Regina?

Rules follow the City of Regina curbside program after the July 1, 2025 change
(processing moved to SK Recycles): glass jars, foam and flexible plastics left the
blue cart and go to SARCAN depots instead. Deposit beverage containers go to SARCAN
for a refund. Always point people to the City's Waste Wizard for edge cases.

The rules are official; the packaging materials of our demo products are not, so the
status shown to users comes from the product's packaging status.
"""
from __future__ import annotations

WASTE_WIZARD = "https://www.regina.ca/SortSmart"
RULES_SOURCE = "https://www.regina.ca/news/Changes-to-Reginas-Curbside-Recycling-Program-Begin-July-1"
SARCAN_LOCATOR = "https://www.sarcan.ca/"

BINS = {
    "blue_cart": {"label": "Blue cart", "icon": "🔵", "where": "Your curbside blue recycling cart"},
    "sarcan": {"label": "SARCAN depot", "icon": "♻️", "where": "Drop off at a SARCAN depot"},
    "sarcan_refund": {"label": "SARCAN (refund)", "icon": "💲", "where": "Return to SARCAN for your deposit refund"},
    "garbage": {"label": "Garbage", "icon": "⚫", "where": "Black garbage cart"},
    "check": {"label": "Check Waste Wizard", "icon": "❓", "where": "Look it up in the City of Regina Waste Wizard"},
}

# (keywords, bin, tip). First matching rule wins, so order matters.
RULES = [
    (("aluminum can", "drink can", "pop can", "beverage can"), "sarcan_refund",
     "Deposit beverage container. Rinse it and return it to SARCAN to get your deposit back."),
    (("plastic bottle", "pet bottle", "water bottle", "juice box", "drink pouch"), "sarcan_refund",
     "Deposit beverage container. Return to SARCAN for the refund."),
    (("foil",), "check", "Clean foil is often accepted, but food-soiled foil is garbage. Check the Waste Wizard."),
    (("glass",), "sarcan", "Glass jars and bottles are no longer accepted in the blue cart since July 2025. Take them to SARCAN."),
    (("foam", "styrofoam", "polystyrene"), "sarcan", "Foam packaging is no longer accepted in the blue cart. Take it to SARCAN."),
    (("flexible", "plastic bag", "plastic liner", "pouch", "film", "plastic wrap", "bubble", "cling", "chip bag"), "sarcan",
     "Flexible plastics (bags, liners, pouches, wrap) go to SARCAN, not the blue cart."),
    (("coffee pod",), "blue_cart", "Empty single-use coffee pods are accepted in the blue cart since July 2025."),
    (("carton",), "blue_cart", "Cartons go in the blue cart. If it is a deposit beverage carton, SARCAN gives you a refund."),
    (("cardboard", "paperboard", "paper"), "blue_cart", "Paper and cardboard go in the blue cart. Flatten boxes."),
    (("metal lid", "tin", "steel", "metal"), "blue_cart", "Metal cans and lids go in the blue cart. Rinse first."),
    (("plastic jar", "plastic tub", "plastic container", "plastic lid", "plastic cap", "plastic"), "blue_cart",
     "Rigid plastic containers, jars and lids go in the blue cart. Empty and rinse them."),
]


def classify(material: str) -> dict:
    m = material.lower()
    for keywords, bin_id, tip in RULES:
        if any(k in m for k in keywords):
            return {"material": material, "bin": bin_id, **BINS[bin_id], "tip": tip}
    return {"material": material, "bin": "check", **BINS["check"],
            "tip": "We don't have a rule for this material. Check the City of Regina Waste Wizard."}


def guidance_for_product(product: dict) -> dict:
    packaging = product.get("packaging") or {}
    materials = packaging.get("materials") or []
    items = [classify(m) for m in materials]
    needs_sarcan = any(i["bin"] in ("sarcan", "sarcan_refund") for i in items)
    return {
        "product_id": product.get("product_id"),
        "product_name": product.get("name"),
        "materials_status": packaging.get("status") or "Unknown",
        "items": items,
        "needs_drop_off": needs_sarcan,
        "summary": _summary(items),
        "sources": [
            {"title": "City of Regina recycling changes (July 2025)", "url": RULES_SOURCE},
            {"title": "City of Regina Waste Wizard", "url": WASTE_WIZARD},
            {"title": "SARCAN depots", "url": SARCAN_LOCATOR},
        ],
    }


def guidance_for_materials(materials: list[str]) -> dict:
    items = [classify(m) for m in materials]
    return {"product_id": None, "product_name": None, "materials_status": "Unknown", "items": items,
            "needs_drop_off": any(i["bin"] in ("sarcan", "sarcan_refund") for i in items),
            "summary": _summary(items),
            "sources": [{"title": "City of Regina Waste Wizard", "url": WASTE_WIZARD},
                        {"title": "SARCAN depots", "url": SARCAN_LOCATOR}]}


def _summary(items: list[dict]) -> str:
    if not items:
        return "Packaging materials are unknown for this product, so we can't say how to dispose of it."
    parts = [f"{i['material'].lower()} → {i['label']}" for i in items]
    return "; ".join(parts) + "."
