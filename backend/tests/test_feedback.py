"""Feedback endpoint. Uses an in-memory SQLite database and a fake mailer, so it never touches
the real database or sends email."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Feedback
from app.routers import feedback


async def post_feedback(payload):
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Feedback.__table__.create)
    session = async_sessionmaker(engine, expire_on_commit=False)
    app = FastAPI()
    app.include_router(feedback.router, prefix="/api")
    send = AsyncMock(return_value=False)
    try:
        with patch.object(feedback, "SessionLocal", session), patch.object(feedback.mailer, "send", send):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                res = await client.post("/api/feedback", json=payload)
        async with session() as db:
            rows = (await db.scalars(select(Feedback))).all()
    finally:
        await engine.dispose()
    return res, rows, send


class FeedbackEndpoint(unittest.TestCase):
    def test_product_name_not_in_catalog_is_saved(self):
        res, rows, send = asyncio.run(post_feedback(
            {"product_name": "  Not In Catalog Crackers  ", "issue": "other", "message": "Wrong origin"}))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["id"], rows[0].id)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].product_id)
        self.assertEqual(rows[0].message, "Product: Not In Catalog Crackers\nWrong origin")
        self.assertIn("(Not In Catalog Crackers)", send.await_args.args[0])


if __name__ == "__main__":
    unittest.main()
