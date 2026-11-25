"""Sign-in, tokens, /me and the admin-only feedback list.

Runs on an in-memory SQLite database with the mailer, Redis and Cloudinary replaced by fakes,
so it never touches the real database, sends email or uploads pictures.
"""
import asyncio
import json
import re
import unittest
from contextlib import ExitStack
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app import redis_client
from app.config import settings
from app.database import Base, get_db
from app.models import EmailCode, RefreshToken, User, utcnow
from app.routers import auth as auth_router, feedback, me
from app.services import avatars, mailer

DIMENSIONS = [d["dimension_id"] for d in json.loads(
    (Path(__file__).resolve().parent.parent / "data" / "ethicalDimensions.json").read_text(encoding="utf-8"))]
SECRET = "test-secret-that-is-long-enough-for-hs256-0123456789"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class Ctx:
    """One test's world: an HTTP client on a fresh app and database, plus the fakes."""

    def __init__(self, client, session, mail, upload, delete):
        self.client, self.session, self.mail, self.upload, self.delete = client, session, mail, upload, delete

    def last_code(self, to: str) -> str:
        call = next(c for c in reversed(self.mail.await_args_list) if c.args[0] == to)
        return re.search(r"code is (\d{6})", call.args[2]).group(1)

    async def post(self, path, json=None, token=None, **kw):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return await self.client.post(path, json=json, headers=headers, **kw)

    async def get(self, path, token=None):
        return await self.client.get(path, headers={"Authorization": f"Bearer {token}"} if token else {})

    async def sign_in(self, email, username="Shopper"):
        r = await self.post("/api/auth/request-code", {"email": email, "username": username})
        assert r.status_code == 200, r.text
        r = await self.post("/api/auth/verify-code", {"email": email, "code": self.last_code(email.lower()), "username": username})
        assert r.status_code == 200, r.text
        return r.json()

    async def db(self, statement):
        async with self.session() as s:
            result = await s.execute(statement)
            await s.commit()
            return result


def run(scenario, **settings_overrides):
    async def main():
        engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        session = async_sessionmaker(engine, expire_on_commit=False)

        async def test_db():
            async with session() as s:
                yield s

        app = FastAPI()
        for r in (auth_router.router, me.router, feedback.router):
            app.include_router(r, prefix="/api")
        app.dependency_overrides[get_db] = test_db
        mail, upload, delete = AsyncMock(return_value=True), AsyncMock(), AsyncMock()
        upload.side_effect = [("https://img.example/a.png", "truevalue/avatars/a"), ("https://img.example/b.png", "truevalue/avatars/b")]
        values = {"JWT_SECRET": SECRET, "CLOUDINARY_URL": "", "ADMIN_EMAILS": "", "ACCESS_TOKEN_MINUTES": 60, **settings_overrides}
        with ExitStack() as stack:
            for key, value in values.items():
                stack.enter_context(patch.object(settings, key, value))
            stack.enter_context(patch.object(redis_client, "redis", None))  # no Redis: the database limits must hold
            stack.enter_context(patch.object(mailer, "send_to", mail))
            stack.enter_context(patch.object(mailer, "send", AsyncMock(return_value=False)))
            stack.enter_context(patch.object(avatars, "upload", upload))
            stack.enter_context(patch.object(avatars, "delete", delete))
            stack.enter_context(patch.object(feedback, "SessionLocal", session))
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    await scenario(Ctx(client, session, mail, upload, delete))
            finally:
                await engine.dispose()

    asyncio.run(main())


class SignIn(unittest.TestCase):
    def test_new_user_gets_tokens(self):
        async def scenario(t):
            r = await t.post("/api/auth/request-code", {"email": "new@example.com"})
            self.assertEqual(r.status_code, 422, "a new email needs a username")
            r = await t.post("/api/auth/request-code", {"email": "  New@Example.com ", "username": " Ada L. "})
            self.assertEqual(r.json(), {"sent": True, "is_new_user": True})
            self.assertIn("It expires in 10 minutes", t.mail.await_args.args[2])
            r = await t.post("/api/auth/verify-code", {"email": "new@example.com", "code": t.last_code("new@example.com"), "username": "Ada L."})
            self.assertEqual(r.status_code, 200, r.text)
            body = r.json()
            self.assertTrue(body["access_token"] and body["refresh_token"])
            self.assertEqual(body["user"]["email"], "new@example.com")
            self.assertEqual(body["user"]["username"], "Ada L.")
            me_ = await t.get("/api/me", body["access_token"])
            self.assertEqual(me_.json()["email"], "new@example.com")
            async with t.session() as s:  # only a hash is stored
                row = await s.scalar(select(EmailCode))
                self.assertNotIn(t.last_code("new@example.com"), row.code_hash)
        run(scenario)

    def test_existing_user_keeps_username(self):
        async def scenario(t):
            await t.sign_in("old@example.com", "Original")
            await t.db(update(EmailCode).values(created_at=utcnow() - timedelta(hours=2)))  # step past the limits
            r = await t.post("/api/auth/request-code", {"email": "old@example.com", "username": "Other"})
            self.assertEqual(r.json(), {"sent": True, "is_new_user": False})
            r = await t.post("/api/auth/verify-code", {"email": "old@example.com", "code": t.last_code("old@example.com")})
            self.assertEqual(r.json()["user"]["username"], "Original")
        run(scenario)

    def test_wrong_code_then_locked_after_five(self):
        async def scenario(t):
            await t.post("/api/auth/request-code", {"email": "lock@example.com", "username": "Lock"})
            code = t.last_code("lock@example.com")
            wrong = "000000" if code != "000000" else "111111"
            attempt = lambda c: t.post("/api/auth/verify-code", {"email": "lock@example.com", "code": c, "username": "Lock"})  # noqa: E731
            for _ in range(4):
                r = await attempt(wrong)
                self.assertEqual((r.status_code, r.json()["detail"]), (400, "That code is not right."))
            r = await attempt(wrong)
            self.assertEqual((r.status_code, r.json()["detail"]), (429, "Too many wrong attempts. Ask for a new code."))
            r = await attempt(code)
            self.assertEqual(r.status_code, 429, "the right code no longer works once locked")
        run(scenario)

    def test_expired_and_used_codes_fail(self):
        async def scenario(t):
            await t.post("/api/auth/request-code", {"email": "late@example.com", "username": "Late"})
            await t.db(update(EmailCode).values(expires_at=utcnow() - timedelta(seconds=1)))
            r = await t.post("/api/auth/verify-code", {"email": "late@example.com", "code": t.last_code("late@example.com"), "username": "Late"})
            self.assertEqual((r.status_code, r.json()["detail"]), (400, "This code has expired. Ask for a new one."))

            await t.sign_in("once@example.com")
            r = await t.post("/api/auth/verify-code", {"email": "once@example.com", "code": t.last_code("once@example.com")})
            self.assertEqual((r.status_code, r.json()["detail"]), (400, "This code was already used. Ask for a new one."))
        run(scenario)

    def test_code_requests_are_limited_without_redis(self):
        async def scenario(t):
            body = {"email": "busy@example.com", "username": "Busy"}
            self.assertEqual((await t.post("/api/auth/request-code", body)).status_code, 200)
            r = await t.post("/api/auth/request-code", body)
            self.assertEqual(r.status_code, 429, "1 per minute")
            self.assertEqual(r.headers["retry-after"], "60")
            # Five in the last hour (spread out so the per-minute limit passes) also blocks
            await t.db(update(EmailCode).values(created_at=utcnow() - timedelta(minutes=30)))
            for _ in range(4):
                await t.db(update(EmailCode).values(created_at=utcnow() - timedelta(minutes=30)))
                self.assertEqual((await t.post("/api/auth/request-code", body)).status_code, 200)
            await t.db(update(EmailCode).values(created_at=utcnow() - timedelta(minutes=30)))
            r = await t.post("/api/auth/request-code", body)
            self.assertEqual((r.status_code, r.headers["retry-after"]), (429, "3600"))
        run(scenario)

    def test_new_code_replaces_the_old_one(self):
        async def scenario(t):
            await t.post("/api/auth/request-code", {"email": "twice@example.com", "username": "Twice"})
            first = t.last_code("twice@example.com")
            await t.db(update(EmailCode).values(created_at=utcnow() - timedelta(minutes=2)))
            await t.post("/api/auth/request-code", {"email": "twice@example.com", "username": "Twice"})
            async with t.session() as s:
                rows = (await s.scalars(select(EmailCode).order_by(EmailCode.id))).all()
            self.assertLessEqual(rows[0].expires_at, rows[1].created_at, "the first code was expired")
            if first != t.last_code("twice@example.com"):
                r = await t.post("/api/auth/verify-code", {"email": "twice@example.com", "code": first, "username": "Twice"})
                self.assertEqual(r.status_code, 400)
        run(scenario)

    def test_sign_in_needs_jwt_secret(self):
        async def scenario(t):
            r = await t.post("/api/auth/request-code", {"email": "x@example.com", "username": "X"})
            self.assertEqual((r.status_code, r.json()["detail"]), (503, "Sign-in is not set up on this server yet."))
            self.assertEqual((await t.get("/api/me")).status_code, 503)
        run(scenario, JWT_SECRET="")


class Tokens(unittest.TestCase):
    def test_refresh_rotation_and_reuse_revokes_everything(self):
        async def scenario(t):
            first = await t.sign_in("rot@example.com")
            r = await t.post("/api/auth/refresh", {"refresh_token": first["refresh_token"]})
            self.assertEqual(r.status_code, 200, r.text)
            second = r.json()
            self.assertNotEqual(second["refresh_token"], first["refresh_token"])
            self.assertEqual((await t.get("/api/me", second["access_token"])).status_code, 200)
            # The old refresh token is used again: treat it as stolen and end every session
            self.assertEqual((await t.post("/api/auth/refresh", {"refresh_token": first["refresh_token"]})).status_code, 401)
            self.assertEqual((await t.post("/api/auth/refresh", {"refresh_token": second["refresh_token"]})).status_code, 401)
            async with t.session() as s:
                live = (await s.scalars(select(RefreshToken).where(RefreshToken.revoked_at.is_(None)))).all()
            self.assertEqual(live, [])
        run(scenario)

    def test_logout_revokes_and_always_returns_204(self):
        async def scenario(t):
            pair = await t.sign_in("out@example.com")
            self.assertEqual((await t.post("/api/auth/logout", {"refresh_token": pair["refresh_token"]})).status_code, 204)
            self.assertEqual((await t.post("/api/auth/refresh", {"refresh_token": pair["refresh_token"]})).status_code, 401)
            self.assertEqual((await t.post("/api/auth/logout", {"refresh_token": "not-a-token"})).status_code, 204)
        run(scenario)

    def test_me_rejects_missing_refresh_type_and_garbage_tokens(self):
        async def scenario(t):
            pair = await t.sign_in("me@example.com")
            self.assertEqual((await t.get("/api/me")).status_code, 401)
            self.assertEqual((await t.get("/api/me", pair["refresh_token"])).status_code, 401, "refresh tokens are not access tokens")
            self.assertEqual((await t.get("/api/me", "abc.def.ghi")).status_code, 401)
        run(scenario)

    def test_me_rejects_expired_access_token(self):
        async def scenario(t):
            pair = await t.sign_in("exp@example.com")
            r = await t.get("/api/me", pair["access_token"])
            self.assertEqual((r.status_code, r.json()["detail"]), (401, "Your session has expired. Please sign in again."))
        run(scenario, ACCESS_TOKEN_MINUTES=-1)


class Me(unittest.TestCase):
    def test_preferences_are_validated_and_saved(self):
        async def scenario(t):
            token = (await t.sign_in("prefs@example.com"))["access_token"]
            good = {d: 50 for d in DIMENSIONS}
            put = lambda body: t.client.put("/api/me/preferences", json=body, headers={"Authorization": f"Bearer {token}"})  # noqa: E731
            r = await put({"weights": {**good, "made_up": 10}, "budget_cad": 20})
            self.assertEqual((r.status_code, r.json()["detail"]), (422, "Unknown value: made_up."))
            self.assertEqual((await put({"weights": {**good, DIMENSIONS[0]: 101}, "budget_cad": 20})).status_code, 422)
            self.assertEqual((await put({"weights": {**good, DIMENSIONS[0]: -1}, "budget_cad": 20})).status_code, 422)
            self.assertEqual((await put({"weights": good, "budget_cad": 20000})).status_code, 422)
            r = await put({"weights": good, "budget_cad": 25.5})
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual((await t.get("/api/me", token)).json()["preferences"], {"weights": good, "budget_cad": 25.5})
        run(scenario)

    def test_username_change(self):
        async def scenario(t):
            token = (await t.sign_in("name@example.com"))["access_token"]
            patch_ = lambda name: t.client.patch("/api/me", json={"username": name}, headers={"Authorization": f"Bearer {token}"})  # noqa: E731
            self.assertEqual((await patch_("x")).status_code, 422)
            self.assertEqual((await patch_("bad<name>")).status_code, 422)
            self.assertEqual((await patch_("  New name  ")).json()["username"], "New name")
        run(scenario)

    def test_email_change_conflict_and_full_flow(self):
        async def scenario(t):
            a = (await t.sign_in("a@example.com", "Ann"))["access_token"]
            await t.sign_in("b@example.com", "Ben")
            r = await t.post("/api/me/email/request", {"new_email": "B@example.com"}, token=a)
            self.assertEqual(r.status_code, 409)
            self.assertEqual(r.json(), {"detail": "That email is already used by another account."})

            r = await t.post("/api/me/email/request", {"new_email": "c@example.com"}, token=a)
            self.assertEqual(r.json(), {"sent": True})
            self.assertEqual(t.mail.await_args.args[0], "c@example.com", "the code goes to the new address")
            r = await t.post("/api/me/email/confirm", {"new_email": "c@example.com", "code": t.last_code("c@example.com")}, token=a)
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.json()["email"], "c@example.com")
            self.assertEqual((await t.get("/api/me", a)).json()["email"], "c@example.com")
            # The old address is free now: asking for a code there would create a new account
            await t.db(update(EmailCode).values(created_at=utcnow() - timedelta(hours=2)))  # step past the rate limit
            r = await t.post("/api/auth/request-code", {"email": "a@example.com", "username": "Ann"})
            self.assertTrue(r.json()["is_new_user"])
        run(scenario)

    def test_avatar_upload_replace_and_remove(self):
        async def scenario(t):
            token = (await t.sign_in("pic@example.com"))["access_token"]
            up = lambda data, ctype="image/png": t.post("/api/me/avatar", token=token, files={"file": ("p.png", data, ctype)})  # noqa: E731
            self.assertEqual((await up(b"just some text", "text/plain")).status_code, 415)
            self.assertEqual((await up(b"not a png at all", "image/png")).status_code, 415, "the bytes are checked, not only the type")
            self.assertEqual((await up(PNG + b"\x00" * (4 * 1024 * 1024))).status_code, 413)
            r = await up(PNG)
            self.assertEqual(r.json()["avatar_url"], "https://img.example/a.png")
            r = await up(PNG)
            self.assertEqual(r.json()["avatar_url"], "https://img.example/b.png")
            t.delete.assert_awaited_with("truevalue/avatars/a")  # the previous picture is deleted
            r = await t.client.delete("/api/me/avatar", headers={"Authorization": f"Bearer {token}"})
            self.assertIsNone(r.json()["avatar_url"])
            t.delete.assert_awaited_with("truevalue/avatars/b")
        run(scenario, CLOUDINARY_URL="cloudinary://key:secret@demo")

    def test_avatar_needs_cloudinary(self):
        async def scenario(t):
            token = (await t.sign_in("nopic@example.com"))["access_token"]
            r = await t.post("/api/me/avatar", token=token, files={"file": ("p.png", PNG, "image/png")})
            self.assertEqual(r.status_code, 503)
        run(scenario)


class FeedbackList(unittest.TestCase):
    def test_feedback_list_is_admin_only(self):
        async def scenario(t):
            r = await t.post("/api/feedback", {"issue": "other", "message": "Price is wrong"})
            self.assertEqual(r.status_code, 201, "anyone may send feedback")
            self.assertEqual((await t.get("/api/feedback")).status_code, 401)
            shopper = (await t.sign_in("shopper@example.com"))["access_token"]
            self.assertEqual((await t.get("/api/feedback", shopper)).status_code, 403)
            admin = (await t.sign_in("boss@example.com"))["access_token"]
            r = await t.get("/api/feedback", admin)
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual([f["message"] for f in r.json()], ["Price is wrong"])
        run(scenario, ADMIN_EMAILS=" Boss@Example.com , other@example.com")


if __name__ == "__main__":
    unittest.main()
