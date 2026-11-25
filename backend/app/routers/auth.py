"""Passwordless sign-in: ask for a code by email, enter it, get tokens. See app/services/auth.py for the rules."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import RefreshIn, RequestCodeIn, VerifyCodeIn
from app.services import auth, mailer

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(auth.auth_configured)])
NEED_USERNAME = "Choose a username (2 to 30 characters) to create your account."


async def send_code(email: str, code: str) -> None:
    minutes = settings.LOGIN_CODE_MINUTES
    sent = await mailer.send_to(
        email, f"Your TrueValue code: {code}",
        f"Your TrueValue code is {code}. It expires in {minutes} minutes. If you did not ask for this, ignore this email.")
    if not sent:
        raise HTTPException(503, "We could not send the code right now. Try again in a minute.")


@router.post("/request-code")
async def request_code(body: RequestCodeIn, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is None and not body.username:
        raise HTTPException(422, NEED_USERNAME)
    code = await auth.issue_code(db, body.email, "login")
    await send_code(body.email, code)
    return {"sent": True, "is_new_user": user is None}


@router.post("/verify-code")
async def verify_code(body: VerifyCodeIn, request: Request, db: AsyncSession = Depends(get_db)):
    await auth.limit_verify_attempts(auth.client_ip(request))
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is None and not body.username:
        raise HTTPException(422, NEED_USERNAME)  # checked before the code, so the code is not used up
    await auth.check_code(db, body.email, "login", body.code)
    if user is None:
        user = User(email=body.email, username=body.username)
        db.add(user)
        try:
            await db.commit()
        except IntegrityError:  # the same email was created a moment ago (two tabs)
            await db.rollback()
            user = await db.scalar(select(User).where(User.email == body.email))
    return await auth.issue_pair(db, user)


@router.post("/refresh")
async def refresh(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    return await auth.rotate(db, body.refresh_token)


@router.post("/logout", status_code=204)
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    await auth.revoke(db, body.refresh_token)
    return Response(status_code=204)
