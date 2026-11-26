"""Email over SMTP (Gmail App Password).

send(): feedback to the team's inbox (FEEDBACK_EMAIL). Best effort: feedback is always saved in the database first.
send_to(): any address, used for sign-in and change-email codes. Needs only the SMTP settings.
"""
import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

log = logging.getLogger("truevalue.mail")


def smtp_enabled() -> bool:
    return bool(settings.SMTP_USER and settings.SMTP_PASSWORD)


def enabled() -> bool:
    return bool(settings.FEEDBACK_EMAIL and smtp_enabled())


def _send(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.MAIL_FROM or settings.SMTP_USER
    msg["To"] = to
    msg.set_content(body)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)


async def send(subject: str, body: str) -> bool:
    if not enabled():
        return False
    try:
        await asyncio.to_thread(_send, settings.FEEDBACK_EMAIL, subject, body)
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("Feedback email failed: %s %s", type(exc).__name__, exc)
        return False


async def send_to(to: str, subject: str, body: str) -> bool:
    if not smtp_enabled():
        log.warning("Email to a user skipped: SMTP_USER or SMTP_PASSWORD is not set")
        return False
    try:
        await asyncio.to_thread(_send, to, subject, body)
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("Email to a user failed: %s %s", type(exc).__name__, exc)
        return False
