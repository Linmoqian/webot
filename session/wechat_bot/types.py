"""Data types for the WeChat bot module."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class WeChatMessage:
    """Incoming WeChat message.

    Attributes:
        user_id: Sender's WeChat user ID.
        text: Text content (may be empty for media-only messages).
        images: Local file paths of downloaded images.
        voice_text: Voice-to-text transcription (if available).
        voice_file: Local path of downloaded voice file (if transcription unavailable).
        files: List of (filename, local_path) tuples.
        videos: Local file paths of downloaded videos.
        message_id: Unique message ID for deduplication.
        context_token: Token required for replying to this user.
        raw: Original protocol message dict (for advanced use).
    """

    user_id: str
    text: str = ""
    images: list[str] = field(default_factory=list)
    voice_text: str = ""
    voice_file: str = ""
    files: list[tuple[str, str]] = field(default_factory=list)  # (filename, path)
    videos: list[str] = field(default_factory=list)
    message_id: str = ""
    context_token: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class WeChatConfig:
    """Configuration for WeChat bot.

    Attributes:
        token: Bot token (obtained via QR login or set manually).
        base_url: API base URL (default: https://ilinkai.weixin.qq.com).
        cdn_base_url: CDN base URL for media upload/download.
        state_dir: Directory for persisting login state. Default: ./wechat_state/
        poll_timeout: Long-poll timeout in seconds.
        max_message_len: Maximum characters per outbound message (WeChat limit: 4000).
        route_tag: Optional SKRouteTag header value.
        verify_ssl: Whether to verify HTTPS certificates.
    """

    token: str = ""
    base_url: str = "https://ilinkai.weixin.qq.com"
    cdn_base_url: str = "https://novac2c.cdn.weixin.qq.com/c2c"
    state_dir: str = ""
    poll_timeout: int = 35
    max_message_len: int = 4000
    route_tag: str | int | None = None
    verify_ssl: bool = True

    @property
    def resolved_state_dir(self) -> Path:
        if self.state_dir:
            return Path(self.state_dir).expanduser()
        return Path("./wechat_state")
