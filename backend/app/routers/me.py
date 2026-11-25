"""The signed-in user's own account: profile, saved preferences, picture and email."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User
from app.routers.auth import send_code
from app.schemas import EmailConfirmIn, EmailRequestIn, PreferencesIn, UsernameIn
from app.services import auth, avatars, catalog

router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(auth.auth_configured)])
EMAIL_TAKEN = "That email is already used by another account."
MAX_AVATAR_BYTES = 4 * 1024 * 1024  # Vercel's request limit is 4.5 MB
AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _looks_like_image(data: bytes) -> bool:
    return (data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n")
            or (data[:4] == b"RIFF" and data[8:12] == b"WEBP"))


async def _email_taken(db: AsyncSession, email: str, user_id: str) -> bool:
    return await db.scalar(select(User.id).where(User.email == email, User.id != user_id)) is not None


@router.get("")
async def read_me(user: User = Depends(auth.get_current_user)):
    return auth.user_out(user)


@router.patch("")
async def update_me(body: UsernameIn, user: User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):
    user.username = body.username
    await db.commit()
    return auth.user_out(user)


@router.put("/preferences")
async def save_preferences(body: PreferencesIn, user: User = Depends(auth.get_current_user),
                           db: AsyncSession = Depends(get_db)):
    known = {d["dimension_id"] for d in catalog.get()["ethicalDimensions"]}
    unknown = sorted(set(body.weights) - known)
    if unknown:
        raise HTTPException(422, f"Unknown value: {', '.join(unknown)}.")
    user.preferences = {"weights": body.weights, "budget_cad": body.budget_cad}
    await db.commit()
    return auth.user_out(user)


@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), user: User = Depends(auth.get_current_user),
                        db: AsyncSession = Depends(get_db)):
    if not settings.avatars_enabled:
        raise HTTPException(503, "Profile pictures are not set up on this server.")
    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "The picture must be 4 MB or smaller.")
    if file.content_type not in AVATAR_TYPES or not _looks_like_image(data):
        raise HTTPException(415, "Use a JPEG, PNG or WebP picture.")
    old = user.avatar_public_id
    user.avatar_url, user.avatar_public_id = await avatars.upload(data)
    await db.commit()
    await avatars.delete(old)
    return auth.user_out(user)


@router.delete("/avatar")
async def remove_avatar(user: User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):
    old = user.avatar_public_id
    user.avatar_url = user.avatar_public_id = None
    await db.commit()
    await avatars.delete(old)
    return auth.user_out(user)


@router.post("/email/request")
async def request_email_change(body: EmailRequestIn, user: User = Depends(auth.get_current_user),
                               db: AsyncSession = Depends(get_db)):
    if body.new_email == user.email:
        raise HTTPException(400, "That is already your email.")
    if await _email_taken(db, body.new_email, user.id):
        raise HTTPException(409, EMAIL_TAKEN)
    code = await auth.issue_code(db, body.new_email, "change_email", user_id=user.id)
    await send_code(body.new_email, code)
    return {"sent": True}


@router.post("/email/confirm")
async def confirm_email_change(body: EmailConfirmIn, user: User = Depends(auth.get_current_user),
                               db: AsyncSession = Depends(get_db)):
    await auth.check_code(db, body.new_email, "change_email", body.code, user_id=user.id)
    if await _email_taken(db, body.new_email, user.id):  # someone took it while the code was on its way
        raise HTTPException(409, EMAIL_TAKEN)
    user.email = body.new_email
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, EMAIL_TAKEN) from None
    return auth.user_out(user)
