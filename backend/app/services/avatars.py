"""Profile pictures on Cloudinary. The Cloudinary SDK is blocking, so every call runs in a thread.

The SDK is imported only when a picture is uploaded or deleted, and only when settings.avatars_enabled
says CLOUDINARY_URL is well formed: on import the SDK reads os.environ["CLOUDINARY_URL"] and raises on
a malformed value, which would otherwise stop the whole API from starting.
"""
import asyncio
import logging
from urllib.parse import unquote, urlparse

from app.config import settings

log = logging.getLogger("truevalue.avatars")
FOLDER = "truevalue/avatars"
_configured_with: str | None = None


def _configure():
    """Import and configure the SDK; returns its uploader module."""
    import cloudinary
    import cloudinary.uploader

    # Settings come from .env through pydantic and are not in os.environ, so split
    # cloudinary://<api_key>:<api_secret>@<cloud_name> and pass the parts explicitly.
    global _configured_with
    if _configured_with != settings.CLOUDINARY_URL:
        url = urlparse(settings.CLOUDINARY_URL.strip())
        cloudinary.config(cloud_name=url.hostname, api_key=unquote(url.username or ""),
                          api_secret=unquote(url.password or ""), secure=True)
        _configured_with = settings.CLOUDINARY_URL
    return cloudinary.uploader


def _upload(data: bytes) -> tuple[str, str]:
    result = _configure().upload(
        data, folder=FOLDER, resource_type="image",
        transformation=[{"width": 256, "height": 256, "crop": "thumb", "gravity": "face"}])  # square, face centred
    return result["secure_url"], result["public_id"]


def _delete(public_id: str) -> None:
    _configure().destroy(public_id, invalidate=True)


async def upload(data: bytes) -> tuple[str, str]:
    """Upload and return (url, public_id)."""
    return await asyncio.to_thread(_upload, data)


async def delete(public_id: str | None) -> None:
    """Best effort: a picture we fail to delete must never fail the request."""
    if not public_id or not settings.avatars_enabled:
        return
    try:
        await asyncio.to_thread(_delete, public_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not delete avatar %s: %s %s", public_id, type(exc).__name__, exc)
