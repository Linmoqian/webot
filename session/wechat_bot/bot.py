"""WeChat Bot — main entry point.

Usage:
    from wechat_bot import WeChatBot, WeChatMessage

    bot = WeChatBot(token="your_token")  # or omit for QR login

    @bot.on_message
    async def handle(msg: WeChatMessage) -> str | None:
        return f"Echo: {msg.text}"

    bot.run()

The callback receives a WeChatMessage and should return:
  - str: reply text to send back
  - None: no reply (message handled elsewhere, or ignored)
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable, Awaitable

import httpx

from .media import download_media, upload_and_send_media
from .protocol import WeChatProtocol
from .types import WeChatConfig, WeChatMessage

# Message type codes
_ITEM_TEXT = 1
_ITEM_IMAGE = 2
_ITEM_VOICE = 3
_ITEM_FILE = 4
_ITEM_VIDEO = 5
_MESSAGE_TYPE_BOT = 2

# Typing constants
_TYPING_TYPING = 1
_TYPING_CANCEL = 2
_TYPING_KEEPALIVE_S = 5

# Retry constants
_MAX_CONSECUTIVE_FAILURES = 3
_BACKOFF_S = 30
_RETRY_S = 2

# Dedup cache limit
_MAX_DEDUP = 1000


class WeChatBot:
    """Standalone WeChat personal bot.

    Args:
        token: Bot token (skip QR login if provided).
        config: Optional full config object.
        media_dir: Directory for media files. Default: ./wechat_media/
        state_dir: Directory for login state. Default: ./wechat_state/
    """

    def __init__(
        self,
        token: str = "",
        *,
        config: WeChatConfig | None = None,
        media_dir: str = "",
        state_dir: str = "",
    ) -> None:
        self.config = config or WeChatConfig(token=token)
        if token and not self.config.token:
            self.config.token = token
        if state_dir:
            self.config.state_dir = state_dir
        if media_dir:
            self._media_dir = Path(media_dir)
        else:
            self._media_dir = Path("./wechat_media")

        self._protocol = WeChatProtocol(self.config)
        self._callback: Callable[[WeChatMessage], Awaitable[str | None]] | None = None
        self._running = False
        self._processed_ids: OrderedDict[str, None] = OrderedDict()
        self._typing_tasks: dict[str, asyncio.Task] = {}

    def on_message(
        self, fn: Callable[[WeChatMessage], Awaitable[str | None]]
    ) -> Callable[[WeChatMessage], Awaitable[str | None]]:
        """Register message handler callback.

        Usage:
            @bot.on_message
            async def handle(msg: WeChatMessage) -> str | None:
                return "Hello!"
        """
        self._callback = fn
        return fn

    def run(self) -> None:
        """Start the bot (blocking). Handles event loop internally."""
        asyncio.run(self._run())

    async def _run(self) -> None:
        """Main async entry point."""
        state_dir = self.config.resolved_state_dir

        # Initialize HTTP client
        self._protocol.client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.config.poll_timeout + 10, connect=30),
            follow_redirects=True,
            verify=self.config.verify_ssl,
        )

        try:
            # Load state or perform QR login
            if self.config.token:
                self._protocol.token = self.config.token
            elif not self._protocol.load_state(state_dir):
                print("[wechat] No saved token, starting QR login...")
                if not await self._protocol.qr_login():
                    print("[wechat] Login failed.")
                    return
                self._protocol.save_state(state_dir)
                print("[wechat] Login successful, token saved.")

            if not self._callback:
                print("[wechat] No message handler registered. Use @bot.on_message")
                return

            self._running = True
            print(f"[wechat] Bot started. Polling for messages...")

            consecutive_failures = 0
            while self._running:
                try:
                    msgs = await self._protocol.poll()
                    for msg in msgs:
                        try:
                            await self._process_message(msg, state_dir)
                        except Exception as e:
                            print(f"[wechat] Error processing message: {e}")
                    consecutive_failures = 0
                except httpx.TimeoutException:
                    continue
                except Exception as e:
                    if not self._running:
                        break
                    consecutive_failures += 1
                    print(f"[wechat] Poll error ({consecutive_failures}): {e}")
                    if consecutive_failures >= _MAX_CONSECUTIVE_FAILURES:
                        consecutive_failures = 0
                        await asyncio.sleep(_BACKOFF_S)
                    else:
                        await asyncio.sleep(_RETRY_S)
        finally:
            for chat_id in list(self._typing_tasks):
                await self._stop_typing(chat_id)
            if self._protocol.client:
                await self._protocol.client.aclose()
                self._protocol.client = None
            self._protocol.save_state(state_dir)
            print("[wechat] Bot stopped.")

    def stop(self) -> None:
        """Signal the bot to stop."""
        self._running = False

    # -- Message processing --

    async def _process_message(self, raw: dict, state_dir: Path) -> None:
        """Parse raw protocol message into WeChatMessage, call callback, send reply."""
        # Skip bot's own messages
        if raw.get("message_type") == _MESSAGE_TYPE_BOT:
            return

        # Dedup
        msg_id = str(raw.get("message_id", "") or raw.get("seq", ""))
        if not msg_id:
            msg_id = f"{raw.get('from_user_id', '')}_{raw.get('create_time_ms', '')}"
        if msg_id in self._processed_ids:
            return
        self._processed_ids[msg_id] = None
        while len(self._processed_ids) > _MAX_DEDUP:
            self._processed_ids.popitem(last=False)

        from_user_id = raw.get("from_user_id", "")
        if not from_user_id:
            return

        # Cache context_token (required for replies)
        ctx_token = raw.get("context_token", "")
        if ctx_token:
            self._protocol.context_tokens[from_user_id] = ctx_token
            self._protocol.save_state(state_dir)

        # Parse items
        item_list: list[dict] = raw.get("item_list") or []
        text_parts: list[str] = []
        images: list[str] = []
        voice_text = ""
        voice_file = ""
        files: list[tuple[str, str]] = []
        videos: list[str] = []

        for item in item_list:
            item_type = item.get("type", 0)

            if item_type == _ITEM_TEXT:
                text = (item.get("text_item") or {}).get("text", "")
                if text:
                    # Handle quoted messages
                    ref = item.get("ref_msg")
                    if ref:
                        ref_item = ref.get("message_item")
                        if ref_item and ref_item.get("type", 0) in (
                            _ITEM_IMAGE, _ITEM_VOICE, _ITEM_FILE, _ITEM_VIDEO,
                        ):
                            text_parts.append(text)
                        else:
                            ref_parts = []
                            if ref.get("title"):
                                ref_parts.append(ref["title"])
                            if ref_item:
                                ref_text = (ref_item.get("text_item") or {}).get("text", "")
                                if ref_text:
                                    ref_parts.append(ref_text)
                            if ref_parts:
                                text_parts.append(f"[引用: {' | '.join(ref_parts)}]\n{text}")
                            else:
                                text_parts.append(text)
                    else:
                        text_parts.append(text)

            elif item_type == _ITEM_IMAGE:
                image_item = item.get("image_item") or {}
                path = await download_media(
                    self._protocol.client, self.config.cdn_base_url,
                    image_item, "image", self._media_dir,
                )
                if path:
                    images.append(path)

            elif item_type == _ITEM_VOICE:
                voice_item = item.get("voice_item") or {}
                vt = voice_item.get("text", "")
                if vt:
                    voice_text = vt
                else:
                    path = await download_media(
                        self._protocol.client, self.config.cdn_base_url,
                        voice_item, "voice", self._media_dir,
                    )
                    if path:
                        voice_file = path

            elif item_type == _ITEM_FILE:
                file_item = item.get("file_item") or {}
                file_name = file_item.get("file_name", "unknown")
                path = await download_media(
                    self._protocol.client, self.config.cdn_base_url,
                    file_item, "file", self._media_dir, file_name,
                )
                if path:
                    files.append((file_name, path))

            elif item_type == _ITEM_VIDEO:
                video_item = item.get("video_item") or {}
                path = await download_media(
                    self._protocol.client, self.config.cdn_base_url,
                    video_item, "video", self._media_dir,
                )
                if path:
                    videos.append(path)

        # Build message
        text = "\n".join(text_parts)
        msg = WeChatMessage(
            user_id=from_user_id,
            text=text,
            images=images,
            voice_text=voice_text,
            voice_file=voice_file,
            files=files,
            videos=videos,
            message_id=msg_id,
            context_token=ctx_token,
            raw=raw,
        )

        # Start typing indicator
        await self._start_typing(from_user_id)

        try:
            # Call user's handler
            reply = await self._callback(msg)

            # Send reply
            if reply:
                ctx = self._protocol.context_tokens.get(from_user_id, "")
                if not ctx:
                    print(f"[wechat] No context_token for {from_user_id}, cannot reply")
                    return

                # Split long messages
                chunks = _split_message(reply, self.config.max_message_len)
                for chunk in chunks:
                    await self._protocol.send_text(from_user_id, chunk, ctx)

                # Upload any media files attached to reply (if user adds them)
                # Not implemented in callback return — user can call bot.send_media() manually
        finally:
            await self._stop_typing(from_user_id)

    # -- Public helpers --

    async def send_media(self, user_id: str, file_path: str) -> bool:
        """Send a media file to a user.

        Can be called from within the message handler or separately.

        Args:
            user_id: Recipient's WeChat user ID.
            file_path: Local path to the file to send.

        Returns:
            True on success.
        """
        ctx = self._protocol.context_tokens.get(user_id, "")
        if not ctx:
            return False

        return await upload_and_send_media(
            client=self._protocol.client,
            api_post=self._protocol._post,
            base_url=self.config.base_url,
            cdn_base_url=self.config.cdn_base_url,
            to_user_id=user_id,
            media_path=file_path,
            context_token=ctx,
        )

    async def send_text(self, user_id: str, text: str) -> None:
        """Send a text message to a user (outside of callback).

        Args:
            user_id: Recipient's WeChat user ID.
            text: Message text.
        """
        ctx = self._protocol.context_tokens.get(user_id, "")
        if not ctx:
            print(f"[wechat] No context_token for {user_id}")
            return

        chunks = _split_message(text, self.config.max_message_len)
        for chunk in chunks:
            await self._protocol.send_text(user_id, chunk, ctx)

    async def login(self, force: bool = False) -> bool:
        """Perform QR code login and save token.

        Args:
            force: Force re-login even if token exists.

        Returns:
            True on success.
        """
        state_dir = self.config.resolved_state_dir

        if force:
            self._protocol.token = ""
            self._protocol.get_updates_buf = ""
            state_file = state_dir / "account.json"
            if state_file.exists():
                state_file.unlink()

        if self._protocol.token or self._protocol.load_state(state_dir):
            return True

        self._protocol.client = httpx.AsyncClient(
            timeout=httpx.Timeout(60, connect=30),
            follow_redirects=True,
            verify=self.config.verify_ssl,
        )
        try:
            success = await self._protocol.qr_login()
            if success:
                self._protocol.save_state(state_dir)
            return success
        finally:
            if self._protocol.client:
                await self._protocol.client.aclose()
                self._protocol.client = None

    # -- Typing indicator --

    async def _start_typing(self, user_id: str) -> None:
        """Start typing indicator with keepalive."""
        await self._stop_typing(user_id)
        try:
            ticket = await self._protocol.get_typing_ticket(user_id)
            if not ticket:
                return
            await self._protocol.send_typing(user_id, ticket, _TYPING_TYPING)
        except Exception:
            return

        stop_event = asyncio.Event()

        async def keepalive() -> None:
            try:
                while not stop_event.is_set():
                    await asyncio.sleep(_TYPING_KEEPALIVE_S)
                    if stop_event.is_set():
                        break
                    try:
                        await self._protocol.send_typing(user_id, ticket, _TYPING_TYPING)
                    except Exception:
                        pass
            finally:
                pass

        task = asyncio.create_task(keepalive())
        task._typing_stop = stop_event  # type: ignore[attr-defined]
        self._typing_tasks[user_id] = task

    async def _stop_typing(self, user_id: str) -> None:
        """Stop typing indicator."""
        task = self._typing_tasks.pop(user_id, None)
        if task and not task.done():
            stop_event = getattr(task, "_typing_stop", None)
            if stop_event:
                stop_event.set()
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


def _split_message(text: str, max_len: int) -> list[str]:
    """Split text into chunks respecting max message length."""
    if len(text) <= max_len:
        return [text] if text.strip() else []

    chunks: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= max_len:
            chunks.append(remaining)
            break
        # Try to split at newline
        split_at = remaining.rfind("\n", 0, max_len)
        if split_at <= 0:
            split_at = remaining.rfind(" ", 0, max_len)
        if split_at <= 0:
            split_at = max_len
        chunks.append(remaining[:split_at])
        remaining = remaining[split_at:].lstrip("\n")
    return chunks
