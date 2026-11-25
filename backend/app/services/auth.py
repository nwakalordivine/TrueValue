"""Passwordless sign-in: 6-digit email codes, JWT access and refresh tokens, and the current-user dependency.

Token storage: the frontend and the API are on different Vercel domains, so httpOnly cookies would have to be
cross-site cookies, which Safari often blocks. Instead the access token travels in the Authorization: Bearer
header and the refresh token in the request body; the browser keeps both in localStorage. If the API is later
served from api.mytruevalue.net (same site as the frontend), we can move to httpOnly cookies.
"""
import hashlib
import hmac
import secrets
from datetime import timedelta

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import EmailCode, RefreshToken, User, as_utc, utcnow
from app.redis_client import hit_rate_limit

ALGORITHM = "HS256"
MAX_ATTEMPTS = 5
CODES_PER_MINUTE, CODES_PER_HOUR = 1, 5


def auth_configured() -> None:
    """Router dependency: without JWT_SECRET the sign-in endpoints answer 503 instead of crashing."""
    if not settings.auth_enabled:
        raise HTTPException(503, "Sign-in is not set up on this server yet.")


def user_out(user: User) -> dict:
    return {"id": user.id, "email": user.email, "username": user.username, "avatar_url": user.avatar_url,
            "preferences": user.preferences}


# ----- email codes -----
def new_code() -> str:
    return f"{secrets.randbelow(10 ** 6):06d}"


def hash_code(purpose: str, email: str, code: str) -> str:
    # Keyed with JWT_SECRET and bound to the email and purpose, so a stolen hash is useless on its own
    return hmac.new(settings.JWT_SECRET.encode(), f"{purpose}:{email}:{code}".encode(), hashlib.sha256).hexdigest()


def _too_many(detail: str, retry_after: int) -> HTTPException:
    return HTTPException(429, detail, headers={"Retry-After": str(retry_after)})


async def issue_code(db: AsyncSession, email: str, purpose: str, user_id: str | None = None) -> str:
    """Check the per-email limits, expire older unused codes, store the new code's hash and return the code."""
    wait_minute = "Please wait a minute before asking for another code."
    wait_hour = "Too many codes were requested for this email. Try again in an hour."
    # Redis is the fast path but optional; the database count below enforces the same limits without it.
    if await hit_rate_limit(f"rl:code:60:{email}", CODES_PER_MINUTE, 60):
        raise _too_many(wait_minute, 60)
    if await hit_rate_limit(f"rl:code:3600:{email}", CODES_PER_HOUR, 3600):
        raise _too_many(wait_hour, 3600)
    now = utcnow()
    count_since = lambda since: select(func.count()).select_from(EmailCode).where(  # noqa: E731
        EmailCode.email == email, EmailCode.created_at > since)
    if await db.scalar(count_since(now - timedelta(seconds=60))) >= CODES_PER_MINUTE:
        raise _too_many(wait_minute, 60)
    if await db.scalar(count_since(now - timedelta(hours=1))) >= CODES_PER_HOUR:
        raise _too_many(wait_hour, 3600)

    await db.execute(update(EmailCode)
                     .where(EmailCode.email == email, EmailCode.purpose == purpose, EmailCode.used_at.is_(None),
                            EmailCode.expires_at > now)
                     .values(expires_at=now))
    code = new_code()
    db.add(EmailCode(email=email, purpose=purpose, user_id=user_id, code_hash=hash_code(purpose, email, code),
                     expires_at=now + timedelta(minutes=settings.LOGIN_CODE_MINUTES), attempts=0, created_at=now))
    await db.commit()
    return code


async def check_code(db: AsyncSession, email: str, purpose: str, code: str, user_id: str | None = None) -> None:
    """Accept the newest code for this email and purpose once. Raises a clear HTTP error otherwise."""
    query = select(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose)
    if user_id:
        query = query.where(EmailCode.user_id == user_id)
    row = await db.scalar(query.order_by(EmailCode.created_at.desc(), EmailCode.id.desc()).limit(1))
    if row is None or row.used_at is not None:
        raise HTTPException(400, "This code was already used. Ask for a new one." if row else
                            "There is no code for this email. Ask for a new one.")
    if as_utc(row.expires_at) <= utcnow():
        raise HTTPException(400, "This code has expired. Ask for a new one.")
    if row.attempts >= MAX_ATTEMPTS:
        raise HTTPException(429, "Too many wrong attempts. Ask for a new code.")
    if not hmac.compare_digest(row.code_hash, hash_code(purpose, email, code)):
        row.attempts += 1
        await db.commit()
        if row.attempts >= MAX_ATTEMPTS:
            raise HTTPException(429, "Too many wrong attempts. Ask for a new code.")
        raise HTTPException(400, "That code is not right.")
    row.used_at = utcnow()
    await db.commit()


# ----- tokens -----
def issue_token(user_id: str, kind: str, lifetime: timedelta) -> tuple[str, str]:
    now, jti = utcnow(), secrets.token_urlsafe(24)
    claims = {"sub": user_id, "type": kind, "jti": jti, "iat": now, "exp": now + lifetime}
    return jwt.encode(claims, settings.JWT_SECRET, algorithm=ALGORITHM), jti


def decode_token(token: str, kind: str) -> dict:
    try:
        claims = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM],
                            options={"require": ["sub", "type", "jti", "iat", "exp"]})
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Your session has expired. Please sign in again.") from None
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Please sign in again.") from None
    if claims["type"] != kind:
        raise HTTPException(401, "Please sign in again.")
    return claims


async def issue_pair(db: AsyncSession, user: User) -> dict:
    access, _ = issue_token(user.id, "access", timedelta(minutes=settings.ACCESS_TOKEN_MINUTES))
    lifetime = timedelta(days=settings.REFRESH_TOKEN_DAYS)
    refresh, jti = issue_token(user.id, "refresh", lifetime)
    db.add(RefreshToken(jti=jti, user_id=user.id, expires_at=utcnow() + lifetime))
    await db.commit()
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_MINUTES * 60, "user": user_out(user)}


async def revoke_all(db: AsyncSession, user_id: str) -> None:
    await db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
                     .values(revoked_at=utcnow()))
    await db.commit()


async def rotate(db: AsyncSession, refresh_token: str) -> dict:
    """Swap a refresh token for a new pair. Reusing an already-rotated token signs the user out everywhere."""
    claims = decode_token(refresh_token, "refresh")
    row = await db.get(RefreshToken, claims["jti"])
    if row is None or row.user_id != claims["sub"]:
        raise HTTPException(401, "Please sign in again.")
    if row.revoked_at is not None:
        # The token was already used once: someone may have stolen it. End every session of this user.
        await revoke_all(db, row.user_id)
        raise HTTPException(401, "Please sign in again.")
    if as_utc(row.expires_at) <= utcnow():
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    user = await db.get(User, row.user_id)
    if user is None:
        raise HTTPException(401, "Please sign in again.")
    row.revoked_at = utcnow()
    return await issue_pair(db, user)  # commits the revocation together with the new token


async def revoke(db: AsyncSession, refresh_token: str) -> None:
    """Log out: revoke this refresh token if it is one of ours. Silent on anything invalid."""
    try:
        claims = jwt.decode(refresh_token, settings.JWT_SECRET, algorithms=[ALGORITHM],
                            options={"verify_exp": False, "require": ["sub", "type", "jti"]})
    except jwt.InvalidTokenError:
        return
    if claims.get("type") != "refresh":
        return
    row = await db.get(RefreshToken, claims["jti"])
    if row is not None and row.revoked_at is None:
        row.revoked_at = utcnow()
        await db.commit()


# ----- current user -----
bearer = HTTPBearer(auto_error=False)


async def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                           db: AsyncSession = Depends(get_db)) -> User:
    auth_configured()
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(401, "Sign in to continue.", headers={"WWW-Authenticate": "Bearer"})
    claims = decode_token(creds.credentials, "access")
    user = await db.get(User, claims["sub"])
    if user is None:
        raise HTTPException(401, "Please sign in again.", headers={"WWW-Authenticate": "Bearer"})
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Signed in and listed in ADMIN_EMAILS."""
    if user.email.lower() not in settings.admin_emails:
        raise HTTPException(403, "Only TrueValue admins can see this.")
    return user


def client_ip(request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "anon").split(",")[0].strip()


async def limit_verify_attempts(ip: str) -> None:
    if await hit_rate_limit(f"rl:verify:{ip}", 10, 600):
        raise _too_many("Too many attempts from your network. Try again in 10 minutes.", 600)
