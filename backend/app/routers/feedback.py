from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.models import Feedback
from app.schemas import FeedbackIn
from app.database import SessionLocal
from app.services import catalog, mailer
from app.services.auth import require_admin

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("", status_code=201)
async def create(body: FeedbackIn):
    # The product name is free text (it may not be in the catalog). There is no column for it,
    # so it is stored as the first line of the message.
    product_name = (body.product_name or "").strip() or None
    message = body.message.strip()
    stored = f"Product: {product_name}\n{message}" if product_name else message
    async with SessionLocal() as db:
        item = Feedback(product_id=body.product_id, issue=body.issue, message=stored)
        db.add(item)
        await db.commit()
        await db.refresh(item)
    if product_name:
        name = product_name
    else:
        product = catalog.product_by_id(body.product_id) if body.product_id else None
        name = product["name"] if product else (body.product_id or "General")
    emailed = await mailer.send(
        f"TrueValue feedback #{item.id}: {body.issue} ({name})",
        f"Product: {name} ({body.product_id or 'none'})\nIssue: {body.issue}\n\n{message}\n\n"
        f"Status: pending review. Saved as feedback #{item.id}.")
    return {"id": item.id, "status": item.status, "emailed": emailed}


@router.get("", dependencies=[Depends(require_admin)])
async def recent(limit: int = 20):
    """Only signed-in admins (ADMIN_EMAILS) may read feedback: 401 when signed out, 403 when not an admin."""
    async with SessionLocal() as db:
        rows = (await db.scalars(select(Feedback).order_by(Feedback.id.desc()).limit(min(limit, 100)))).all()
    return [{"id": r.id, "product_id": r.product_id, "issue": r.issue, "message": r.message,
             "status": r.status, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]
