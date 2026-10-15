"""Send feedback to the team's inbox over SMTP. Best effort: feedback is always saved in the database first."""
import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

log = logging.getLogger("truevalue.mail")


def enabled() -> bool:
    return bool(settings.FEEDBACK_EMAIL and settings.SMTP_USER and settings.SMTP_PASSWORD)


def _send(subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.MAIL_FROM or settings.SMTP_USER
    msg["To"] = settings.FEEDBACK_EMAIL
    msg.set_content(body)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)


async def send(subject: str, body: str) -> bool:
    if not enabled():
        return False
    try:
        await asyncio.to_thread(_send, subject, body)
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("Feedback email failed: %s %s", type(exc).__name__, exc)
        return False
