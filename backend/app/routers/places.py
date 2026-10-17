from fastapi import APIRouter, HTTPException, Query

from app.services import places

router = APIRouter(prefix="/places", tags=["places"])


@router.get("/stores")
async def stores(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                 category: str | None = None, limit: int = Query(6, ge=1, le=15)):
    try:
        items = await places.nearest_stores(lat, lon, category, limit)
    except RuntimeError:
        raise HTTPException(503, "Map data (OpenStreetMap) is unavailable right now. Try again shortly.")
    return {"items": items, "note": "Real stores from OpenStreetMap. Product stock is not confirmed."}


@router.get("/drop-offs")
async def drop_offs(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                    limit: int = Query(6, ge=1, le=15)):
    try:
        items = await places.nearest_drop_offs(lat, lon, limit)
    except RuntimeError:
        raise HTTPException(503, "Map data (OpenStreetMap) is unavailable right now. Try again shortly.")
    return {"items": items, "note": "SARCAN depots and recycling drop-off points from OpenStreetMap."}
