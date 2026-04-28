from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass

import httpx

from config.settings import ProviderConfig


@dataclass
class TextDelta:
    content: str


class OpenAIProvider:
    def __init__(self, config: ProviderConfig) -> None:
        self._config = config
        self._client = httpx.AsyncClient(
            base_url=config.base_url,
            headers={"Authorization": f"Bearer {config.api_key}"},
            timeout=httpx.Timeout(config.timeout, connect=15),
            verify=config.verify_ssl,
        )

    async def chat_stream(
        self, messages: list[dict]
    ) -> AsyncGenerator[TextDelta, None]:
        payload = {
            "model": self._config.model,
            "messages": messages,
            "stream": True,
        }
        async with self._client.stream(
            "POST", "/chat/completions", json=payload
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    return
                try:
                    obj = json.loads(raw)
                    delta = obj["choices"][0]["delta"]
                    content = delta.get("content")
                    if content:
                        yield TextDelta(content=content)
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue

    async def close(self) -> None:
        await self._client.aclose()
