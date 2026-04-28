from __future__ import annotations

import json
import os
from dataclasses import dataclass


@dataclass
class ProviderConfig:
    base_url: str = "http://localhost:11434/v1"
    api_key: str = "ollama"
    model: str = "gemma4:e2b"
    verify_ssl: bool = False
    timeout: int = 60


@dataclass
class AgentConfig:
    system_prompt: str = "You are a helpful assistant."
    max_context_messages: int = 20


@dataclass
class WeChatSettings:
    base_url: str = ""
    verify_ssl: bool = True
    state_dir: str = "./config/wechat_state"
    poll_timeout: int = 30


@dataclass
class Settings:
    provider: ProviderConfig
    agent: AgentConfig
    wechat: WeChatSettings


def load_settings(path: str | None = None) -> Settings:
    if path is None:
        path = os.environ.get("WEBOT_CONFIG", "config.json")

    if not os.path.exists(path):
        return Settings(
            provider=ProviderConfig(),
            agent=AgentConfig(),
            wechat=WeChatSettings(),
        )

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    return Settings(
        provider=ProviderConfig(**data.get("provider", {})),
        agent=AgentConfig(**data.get("agent", {})),
        wechat=WeChatSettings(**data.get("wechat", {})),
    )
