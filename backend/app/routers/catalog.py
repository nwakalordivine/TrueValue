from fastapi import APIRouter, HTTPException

from app.schemas import WeightsIn
from app.services import assistant, catalog, disposal

router = APIRouter(tags=["catalog"])


@router.get("/catalog")
async def get_catalog():
    """Everything the web page needs, in the same shape as the old src/data/*.json files."""
    return {**catalog.get(), "loaded_from": catalog.source()}


@router.post("/products/{product_id}/card")
async def product_card(product_id: str, body: WeightsIn):
    """The True Value Card: score, verdict, breakdown, alternatives, ownership chain."""
    product = catalog.product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    weights = {**catalog.default_weights(), **(body.weights or {})}
    return assistant.product_card(product, weights)


@router.get("/products/{product_id}/disposal")
async def product_disposal(product_id: str):
    product = catalog.product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    return disposal.guidance_for_product(product)


class BarcodeIn(WeightsIn):
    barcode: str


@router.post("/barcode")
async def barcode_lookup(body: BarcodeIn):
    """Scan result: demo catalog first, then Open Food Facts. Always 200; check `found`."""
    weights = {**catalog.default_weights(), **(body.weights or {})}
    return await assistant.lookup_barcode(body.barcode, weights)


@router.get("/search")
async def search_products(q: str, limit: int = 12):
    """Search by name: matching demo products first, then real products from Open Food Facts."""
    from fastapi import HTTPException
    from app.services import openfoodfacts

    q = q.strip()
    if len(q) < 2:
        raise HTTPException(400, "Type at least two letters.")
    words = q.lower().split()
    demo = [{"product_id": p["product_id"], "barcode": p.get("barcode"), "name": p["name"], "brand": p.get("brand"),
             "quantity": p.get("size"), "image": None, "emoji": p.get("emoji"), "source": "demo"}
            for p in catalog.get()["products"]
            if all(w in f"{p['name']} {p.get('brand', '')} {p.get('category', '')}".lower() for w in words)]
    try:
        real = await openfoodfacts.search(q, max(1, min(limit, 24)))
        error = None
    except Exception:  # noqa: BLE001
        real, error = [], "Product search is busy right now. Wait a few seconds and try again, or type the barcode instead."
    return {"query": q, "items": demo[:3] + real, "error": error}
