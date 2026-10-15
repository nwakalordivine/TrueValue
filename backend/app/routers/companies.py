from fastapi import APIRouter, HTTPException, Query

from app.services import registry

router = APIRouter(prefix="/companies", tags=["registry"])


@router.get("/search")
async def search(q: str = Query(min_length=2, max_length=120), limit: int = Query(5, ge=1, le=20)):
    return await registry.search_companies(q, limit)


@router.get("/{corporation_number}")
async def get_one(corporation_number: str):
    company = await registry.get_company(corporation_number)
    if not company:
        raise HTTPException(404, "Corporation not found")
    return company
