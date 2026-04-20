"""WeChat HTTP protocol layer.

Implements the ilinkai.weixin.qq.com API protocol for:
  - QR code authentication
  - HTTP long-polling for incoming messages
  - Sending text messages
  - Typing indicators

Protocol reverse-engineered from @tencent-weixin/openclaw-weixin v1.0.3.
"""

from __future__ import annotations

import base64
import json
import os
import uuid
from pathlib import Path
from typing import Any

import httpx

from .types import WeChatConfig


def _encode_version(version: str) -> int:
    """Encode semver as 0x00MMNNPP uint32."""
    parts = version.split(".")
    major = int(parts[0]) if len(parts) > 0 else 0
    minor = int(parts[1]) if len(parts) > 1 else 0
    patch = int(parts[2]) if len(parts) > 2 else 0
    return ((major & 0xFF) << 16) | ((minor & 0xFF) << 8) | (patch & 0xFF)


# Protocol constants
_CHANNEL_VERSION = "2.1.1"
_APP_ID = "bot"
_APP_CLIENT_VERSION = _encode_version(_CHANNEL_VERSION)
_BASE_INFO: dict[str, str] = {"channel_version": _CHANNEL_VERSION}

_ITEM_TEXT = 1
_MESSAGE_TYPE_BOT = 2
_MESSAGE_STATE_FINISH = 2

_ERRCODE_SESSION_EXPIRED = -14
_SESSION_PAUSE_S = 3600  # 60 min pause on session expiry
_MAX_CONSECUTIVE_FAILURES = 3
_BACKOFF_S = 30
_RETRY_S = 2
_MAX_QR_REFRESH = 3


def _random_uin() -> str:
    """Generate random X-WECHAT-UIN header value."""
    uint32 = int.from_bytes(os.urandom(4), "big")
    return base64.b64encode(str(uint32).encode()).decode()


class WeChatProtocol:
    """Low-level WeChat API client.

    Handles HTTP requests, authentication headers, and state persistence.
    """

    def __init__(self, config: WeChatConfig) -> None:
        self.config = config
        self.client: httpx.AsyncClient | None = None
        self.token: str = config.token
        self.get_updates_buf: str = ""
        self.context_tokens: dict[str, str] = {}  # user_id -> context_token
        self.typing_tickets: dict[str, dict[str, Any]] = {}  # user_id -> ticket cache
        self._session_pause_until: float = 0.0
        self._next_poll_timeout: int = config.poll_timeout

    # -- State persistence --

    def load_state(self, state_dir: Path) -> bool:
        """Load login state from disk. Returns True if valid token found."""
        state_file = state_dir / "account.json"
        if not state_file.exists():
            return False
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
            self.token = data.get("token", "")
            self.get_updates_buf = data.get("get_updates_buf", "")
            ct = data.get("context_tokens", {})
            if isinstance(ct, dict):
                self.context_tokens = {
                    str(k): str(v) for k, v in ct.items() if str(k).strip() and str(v).strip()
                }
            base_url = data.get("base_url", "")
            if base_url:
                self.config.base_url = base_url
            return bool(self.token)
        except Exception:
            return False

    def save_state(self, state_dir: Path) -> None:
        """Persist current state to disk."""
        state_dir.mkdir(parents=True, exist_ok=True)
        state_file = state_dir / "account.json"
        try:
            data = {
                "token": self.token,
                "get_updates_buf": self.get_updates_buf,
                "context_tokens": self.context_tokens,
                "base_url": self.config.base_url,
            }
            state_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    # -- HTTP helpers --

    def _headers(self, *, auth: bool = True) -> dict[str, str]:
        """Build per-request headers (new random UIN each call)."""
        headers: dict[str, str] = {
            "X-WECHAT-UIN": _random_uin(),
            "Content-Type": "application/json",
            "AuthorizationType": "ilink_bot_token",
            "iLink-App-Id": _APP_ID,
            "iLink-App-ClientVersion": str(_APP_CLIENT_VERSION),
        }
        if auth and self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if self.config.route_tag is not None and str(self.config.route_tag).strip():
            headers["SKRouteTag"] = str(self.config.route_tag).strip()
        return headers

    async def _get(
        self,
        endpoint: str,
        params: dict | None = None,
        *,
        auth: bool = True,
        base_url: str | None = None,
    ) -> dict:
        """HTTP GET to WeChat API."""
        assert self.client is not None
        url = f"{base_url or self.config.base_url}/{endpoint}"
        resp = await self.client.get(url, params=params, headers=self._headers(auth=auth))
        resp.raise_for_status()
        return resp.json()

    async def _post(self, endpoint: str, body: dict | None = None) -> dict:
        """HTTP POST to WeChat API."""
        assert self.client is not None
        url = f"{self.config.base_url}/{endpoint}"
        payload = body or {}
        if "base_info" not in payload:
            payload["base_info"] = _BASE_INFO
        resp = await self.client.post(url, json=payload, headers=self._headers())
        resp.raise_for_status()
        return resp.json()

    # -- QR code login --

    async def qr_login(self) -> bool:
        """Perform QR code login flow.

        Prints ASCII QR code to terminal. User scans with WeChat.
        Returns True on successful authentication.
        """
        refresh_count = 0
        qrcode_id, scan_url = await self._fetch_qr()
        self._print_qr(scan_url)
        current_base = self.config.base_url

        while True:
            try:
                data = await self._get(
                    "ilink/bot/get_qrcode_status",
                    params={"qrcode": qrcode_id},
                    auth=False,
                    base_url=current_base,
                )
            except (httpx.TimeoutException, httpx.TransportError):
                import asyncio
                await asyncio.sleep(1)
                continue
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500:
                    import asyncio
                    await asyncio.sleep(1)
                    continue
                raise

            status = data.get("status", "")
            if status == "confirmed":
                token = data.get("bot_token", "")
                base_url = data.get("baseurl", "")
                if token:
                    self.token = token
                    if base_url:
                        self.config.base_url = base_url
                    return True
                return False
            elif status == "scaned_but_redirect":
                redirect = str(data.get("redirect_host", "") or "").strip()
                if redirect:
                    scheme = "" if redirect.startswith("http") else "https://"
                    current_base = f"{scheme}{redirect}"
            elif status == "expired":
                refresh_count += 1
                if refresh_count > _MAX_QR_REFRESH:
                    return False
                qrcode_id, scan_url = await self._fetch_qr()
                current_base = self.config.base_url
                self._print_qr(scan_url)
                continue

            import asyncio
            await asyncio.sleep(1)

    async def _fetch_qr(self) -> tuple[str, str]:
        """Fetch a fresh QR code. Returns (qrcode_id, scan_url)."""
        data = await self._get(
            "ilink/bot/get_bot_qrcode",
            params={"bot_type": "3"},
            auth=False,
        )
        qrcode_id = data.get("qrcode", "")
        if not qrcode_id:
            raise RuntimeError(f"Failed to get QR code: {data}")
        scan_url = data.get("qrcode_img_content", "") or qrcode_id
        return qrcode_id, scan_url

    @staticmethod
    def _print_qr(url: str) -> None:
        """Print ASCII QR code to terminal."""
        try:
            import qrcode as qr_lib

            qr = qr_lib.QRCode(border=1)
            qr.add_data(url)
            qr.make(fit=True)
            qr.print_ascii(invert=True)
        except ImportError:
            print(f"\nLogin URL: {url}\n")

    # -- Long polling --

    async def poll(self) -> list[dict]:
        """Long-poll for new messages. Returns list of raw message dicts.

        Handles:
          - Server-suggested poll timeout
          - Session expiry (errcode -14) with auto-pause
          - Cursor (get_updates_buf) persistence

        Raises on unrecoverable errors.
        """
        import asyncio
        import time

        # Respect session pause
        remaining = int(self._session_pause_until - time.time())
        if remaining > 0:
            await asyncio.sleep(remaining)
            return []

        body: dict[str, Any] = {
            "get_updates_buf": self.get_updates_buf,
            "base_info": _BASE_INFO,
        }

        assert self.client is not None
        self.client.timeout = httpx.Timeout(self._next_poll_timeout + 10, connect=30)
        data = await self._post("ilink/bot/getupdates", body)

        ret = data.get("ret", 0)
        errcode = data.get("errcode", 0)
        is_error = (ret is not None and ret != 0) or (errcode is not None and errcode != 0)

        if is_error:
            if errcode == _ERRCODE_SESSION_EXPIRED or ret == _ERRCODE_SESSION_EXPIRED:
                self._session_pause_until = time.time() + _SESSION_PAUSE_S
                print(f"[wechat] Session expired, pausing {_SESSION_PAUSE_S // 60} min")
                return []
            raise RuntimeError(
                f"getUpdates failed: ret={ret} errcode={errcode} msg={data.get('errmsg', '')}"
            )

        # Update poll timeout from server hint
        server_ms = data.get("longpolling_timeout_ms")
        if server_ms and server_ms > 0:
            self._next_poll_timeout = max(server_ms // 1000, 5)

        # Update cursor
        new_buf = data.get("get_updates_buf", "")
        if new_buf:
            self.get_updates_buf = new_buf

        return data.get("msgs", []) or []

    # -- Sending messages --

    async def send_text(
        self, to_user_id: str, text: str, context_token: str
    ) -> None:
        """Send a text message."""
        from .media import _ITEM_TEXT, _MESSAGE_TYPE_BOT, _MESSAGE_STATE_FINISH

        item_list: list[dict] = []
        if text:
            item_list.append({"type": _ITEM_TEXT, "text_item": {"text": text}})

        weixin_msg: dict[str, Any] = {
            "from_user_id": "",
            "to_user_id": to_user_id,
            "client_id": f"bot-{uuid.uuid4().hex[:12]}",
            "message_type": _MESSAGE_TYPE_BOT,
            "message_state": _MESSAGE_STATE_FINISH,
        }
        if item_list:
            weixin_msg["item_list"] = item_list
        if context_token:
            weixin_msg["context_token"] = context_token

        data = await self._post("ilink/bot/sendmessage", {"msg": weixin_msg})
        errcode = data.get("errcode", 0)
        if errcode and errcode != 0:
            print(f"[wechat] Send error ({errcode}): {data.get('errmsg', '')}")

    async def send_typing(self, user_id: str, ticket: str, status: int) -> None:
        """Send typing indicator (1=typing, 2=cancel)."""
        body: dict[str, Any] = {
            "ilink_user_id": user_id,
            "typing_ticket": ticket,
            "status": status,
            "base_info": _BASE_INFO,
        }
        await self._post("ilink/bot/sendtyping", body)

    async def get_typing_ticket(self, user_id: str) -> str:
        """Get typing ticket with per-user caching."""
        import random
        import time

        _TTL = 86400  # 24h
        _INIT_RETRY = 2

        now = time.time()
        entry = self.typing_tickets.get(user_id)
        if entry and now < float(entry.get("next_fetch_at", 0)):
            return str(entry.get("ticket", "") or "")

        data = await self._post("ilink/bot/getconfig", {
            "ilink_user_id": user_id,
            "context_token": self.context_tokens.get(user_id, "") or None,
        })

        if data.get("ret", 0) == 0:
            ticket = str(data.get("typing_ticket", "") or "")
            self.typing_tickets[user_id] = {
                "ticket": ticket,
                "next_fetch_at": now + (random.random() * _TTL),
            }
            return ticket

        prev = float(entry.get("retry_delay_s", _INIT_RETRY)) if entry else _INIT_RETRY
        if entry:
            entry["next_fetch_at"] = now + prev * 2
            return str(entry.get("ticket", "") or "")
        return ""
