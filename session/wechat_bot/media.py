"""Media download and upload for WeChat.

Handles:
  - Downloading + AES decrypting inbound media (images, voice, files, videos)
  - AES encrypting + uploading outbound media to WeChat CDN

Protocol (from @tencent-weixin/openclaw-weixin v1.0.3):
  Download: GET CDN url -> AES-128-ECB decrypt -> save to disk
  Upload:   AES-128-ECB encrypt -> POST to CDN -> get download param -> sendmessage
"""

from __future__ import annotations

import base64
import hashlib
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from . import crypto

# File extension sets
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".ico", ".svg"}
_VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv"}
_VOICE_EXTS = {".mp3", ".wav", ".amr", ".silk", ".ogg", ".m4a", ".aac", ".flac"}

# Protocol constants
_UPLOAD_MEDIA_IMAGE = 1
_UPLOAD_MEDIA_VIDEO = 2
_UPLOAD_MEDIA_FILE = 3
_UPLOAD_MEDIA_VOICE = 4

_ITEM_TEXT = 1
_ITEM_IMAGE = 2
_ITEM_VOICE = 3
_ITEM_FILE = 4
_ITEM_VIDEO = 5

_MESSAGE_TYPE_BOT = 2
_MESSAGE_STATE_FINISH = 2


def _has_download_url(media: dict[str, Any] | None) -> bool:
    """Check if a media dict has downloadable URL data."""
    if not isinstance(media, dict):
        return False
    eqp = str(media.get("encrypt_query_param", "") or "").strip()
    full = str(media.get("full_url", "") or "").strip()
    return bool(eqp or full)


def _ext_for_type(media_type: str) -> str:
    """Get file extension for a media type."""
    return {"image": ".jpg", "voice": ".silk", "video": ".mp4", "file": ""}.get(
        media_type, ""
    )


def _guess_upload_type(filename: str) -> tuple[int, int, str]:
    """Determine upload media type, item type, and item key from filename extension.

    Returns:
        (upload_media_type, item_type, item_key)
    """
    ext = Path(filename).suffix.lower()
    if ext in _IMAGE_EXTS:
        return _UPLOAD_MEDIA_IMAGE, _ITEM_IMAGE, "image_item"
    if ext in _VIDEO_EXTS:
        return _UPLOAD_MEDIA_VIDEO, _ITEM_VIDEO, "video_item"
    if ext in _VOICE_EXTS:
        return _UPLOAD_MEDIA_VOICE, _ITEM_VOICE, "voice_item"
    return _UPLOAD_MEDIA_FILE, _ITEM_FILE, "file_item"


async def download_media(
    client: httpx.AsyncClient,
    cdn_base_url: str,
    typed_item: dict[str, Any],
    media_type: str,
    save_dir: Path,
    filename: str | None = None,
) -> str | None:
    """Download and decrypt a media item from WeChat CDN.

    Args:
        client: HTTP client for requests.
        cdn_base_url: CDN base URL.
        typed_item: The typed item dict (e.g. image_item, file_item).
        media_type: One of "image", "voice", "file", "video".
        save_dir: Directory to save downloaded files.
        filename: Optional filename override.

    Returns:
        Local file path on success, None on failure.
    """
    try:
        media = typed_item.get("media") or {}
        encrypt_query_param = str(media.get("encrypt_query_param", "") or "").strip()
        full_url = str(media.get("full_url", "") or "").strip()

        if not encrypt_query_param and not full_url:
            return None

        # Resolve AES key
        # image_item.aeskey is raw hex (32 chars) -> convert to base64
        # media.aes_key is always base64
        raw_aeskey_hex = typed_item.get("aeskey", "")
        media_aes_key_b64 = media.get("aes_key", "")

        aes_key_b64 = ""
        if raw_aeskey_hex:
            aes_key_b64 = base64.b64encode(bytes.fromhex(raw_aeskey_hex)).decode()
        elif media_aes_key_b64:
            aes_key_b64 = media_aes_key_b64

        # Non-image media requires AES key
        if media_type != "image" and not aes_key_b64:
            return None

        # Build download URL candidates
        fallback_url = ""
        if encrypt_query_param:
            fallback_url = (
                f"{cdn_base_url}/download"
                f"?encrypted_query_param={quote(encrypt_query_param)}"
            )

        candidates: list[tuple[str, str]] = []
        if full_url:
            candidates.append(("full_url", full_url))
        if fallback_url and (not full_url or fallback_url != full_url):
            candidates.append(("encrypt_query_param", fallback_url))

        # Try each URL
        data = b""
        for source, cdn_url in candidates:
            try:
                resp = await client.get(cdn_url)
                resp.raise_for_status()
                data = resp.content
                break
            except Exception:
                continue

        if not data:
            return None

        # Decrypt if key available
        if aes_key_b64:
            data = crypto.decrypt(data, aes_key_b64)

        # Save to disk
        save_dir.mkdir(parents=True, exist_ok=True)
        if not filename:
            ts = int(time.time())
            h = abs(hash(encrypt_query_param or full_url)) % 100000
            filename = f"{media_type}_{ts}_{h}{_ext_for_type(media_type)}"
        safe_name = os.path.basename(filename)
        file_path = save_dir / safe_name
        file_path.write_bytes(data)
        return str(file_path)

    except Exception:
        return None


async def upload_and_send_media(
    client: httpx.AsyncClient,
    api_post,  # callable: async (endpoint, body) -> dict
    base_url: str,
    cdn_base_url: str,
    to_user_id: str,
    media_path: str,
    context_token: str,
) -> bool:
    """Upload a local file to WeChat CDN and send it as a media message.

    Protocol:
      1. Generate random 16-byte AES key
      2. Call getuploadurl with file metadata + AES key
      3. AES-128-ECB encrypt file data and POST to CDN
      4. Read x-encrypted-param from CDN response
      5. Send sendmessage with media item referencing the upload

    Args:
        client: HTTP client.
        api_post: Async callable for API POST requests.
        base_url: API base URL.
        cdn_base_url: CDN base URL.
        to_user_id: Recipient user ID.
        media_path: Local file path to upload.
        context_token: Context token for the conversation.

    Returns:
        True on success, False on failure.
    """
    try:
        p = Path(media_path)
        if not p.is_file():
            return False

        raw_data = p.read_bytes()
        raw_size = len(raw_data)
        raw_md5 = hashlib.md5(raw_data).hexdigest()

        upload_type, item_type, item_key = _guess_upload_type(p.name)

        # Client-side AES key
        aes_key_raw = os.urandom(16)
        aes_key_hex = aes_key_raw.hex()

        # PKCS7 padded size
        padded_size = ((raw_size + 1 + 15) // 16) * 16

        # Step 1: Get upload URL
        file_key = os.urandom(16).hex()
        upload_resp = await api_post("ilink/bot/getuploadurl", {
            "filekey": file_key,
            "media_type": upload_type,
            "to_user_id": to_user_id,
            "rawsize": raw_size,
            "rawfilemd5": raw_md5,
            "filesize": padded_size,
            "no_need_thumb": True,
            "aeskey": aes_key_hex,
        })

        upload_full_url = str(upload_resp.get("upload_full_url", "") or "").strip()
        upload_param = str(upload_resp.get("upload_param", "") or "")
        if not upload_full_url and not upload_param:
            return False

        # Step 2: Encrypt and upload to CDN
        aes_key_b64 = base64.b64encode(aes_key_raw).decode()
        encrypted_data = crypto.encrypt(raw_data, aes_key_b64)

        if upload_full_url:
            cdn_url = upload_full_url
        else:
            cdn_url = (
                f"{cdn_base_url}/upload"
                f"?encrypted_query_param={quote(upload_param)}"
                f"&filekey={quote(file_key)}"
            )

        cdn_resp = await client.post(
            cdn_url,
            content=encrypted_data,
            headers={"Content-Type": "application/octet-stream"},
        )
        cdn_resp.raise_for_status()

        download_param = cdn_resp.headers.get("x-encrypted-param", "")
        if not download_param:
            return False

        # Step 3: Send message with media reference
        cdn_aes_key_b64 = base64.b64encode(aes_key_hex.encode()).decode()

        import uuid

        media_item: dict[str, Any] = {
            "media": {
                "encrypt_query_param": download_param,
                "aes_key": cdn_aes_key_b64,
                "encrypt_type": 1,
            },
        }

        if item_type == _ITEM_IMAGE:
            media_item["mid_size"] = padded_size
        elif item_type == _ITEM_VIDEO:
            media_item["video_size"] = padded_size
        elif item_type == _ITEM_FILE:
            media_item["file_name"] = p.name
            media_item["len"] = str(raw_size)

        item_list = [{"type": item_type, item_key: media_item}]
        weixin_msg: dict[str, Any] = {
            "from_user_id": "",
            "to_user_id": to_user_id,
            "client_id": f"bot-{uuid.uuid4().hex[:12]}",
            "message_type": _MESSAGE_TYPE_BOT,
            "message_state": _MESSAGE_STATE_FINISH,
            "item_list": item_list,
        }
        if context_token:
            weixin_msg["context_token"] = context_token

        await api_post("ilink/bot/sendmessage", {"msg": weixin_msg})
        return True

    except Exception:
        return False
