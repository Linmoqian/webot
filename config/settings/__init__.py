"""统一配置加载 — settings.json + 环境变量覆盖"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from config.providers import ProviderConfig

_SETTINGS_FILE = Path(__file__).parent / "settings.json"


@dataclass(frozen=True)
class WeChatSettings:
    base_url: str = "https://ilinkai.weixin.qq.com"
    verify_ssl: bool = True
    state_dir: str = "./config/wechat_state"
    poll_timeout: int = 35


@dataclass(frozen=True)
class AgentSettings:
    system_prompt: str = "你是一个简洁可靠的 AI 助手。"
    max_context_messages: int = 20
    max_turns: int = 20


@dataclass(frozen=True)
class Settings:
    provider: ProviderConfig
    wechat: WeChatSettings
    agent: AgentSettings


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int) -> int:
    val = os.environ.get(name)
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def load_settings(path: Path | str | None = None) -> Settings:
    """加载 settings.json，环境变量优先级更高"""
    file_path = Path(path) if path else _SETTINGS_FILE

    raw: dict[str, Any] = {}
    if file_path.exists():
        raw = json.loads(file_path.read_text(encoding="utf-8"))

    p = raw.get("provider", {})
    provider = ProviderConfig(
        base_url=os.environ.get("LLM_BASE_URL", p.get("base_url")),
        api_key=os.environ.get("LLM_API_KEY", p.get("api_key", "")),
        model=os.environ.get("LLM_MODEL", p.get("model", "gemma4:e2B")),
        verify_ssl=_env_bool("LLM_VERIFY_SSL", p.get("verify_ssl", True)),
        max_tokens=_env_int("LLM_MAX_TOKENS", p.get("max_tokens", 4096)),
        temperature=float(os.environ.get("LLM_TEMPERATURE", p.get("temperature", 0.7))),
    )

    w = raw.get("wechat", {})
    wechat = WeChatSettings(
        base_url=os.environ.get("WECHAT_BASE_URL", w.get("base_url", WeChatSettings.base_url)),
        verify_ssl=_env_bool("WECHAT_VERIFY_SSL", w.get("verify_ssl", WeChatSettings.verify_ssl)),
        state_dir=os.environ.get("WECHAT_STATE_DIR", w.get("state_dir", WeChatSettings.state_dir)),
        poll_timeout=_env_int("WECHAT_POLL_TIMEOUT", w.get("poll_timeout", WeChatSettings.poll_timeout)),
    )

    a = raw.get("agent", {})
    agent = AgentSettings(
        system_prompt=os.environ.get("AGENT_SYSTEM_PROMPT", a.get("system_prompt", AgentSettings.system_prompt)),
        max_context_messages=_env_int("AGENT_MAX_CONTEXT", a.get("max_context_messages", AgentSettings.max_context_messages)),
        max_turns=_env_int("AGENT_MAX_TURNS", a.get("max_turns", AgentSettings.max_turns)),
    )

    return Settings(provider=provider, wechat=wechat, agent=agent)
