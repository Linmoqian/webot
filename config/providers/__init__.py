"""LLM 提供商 — OpenAI 兼容格式"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import AsyncGenerator

import httpx
from openai import AsyncOpenAI

from agent import Event, TextDelta, ToolCall


@dataclass(frozen=True)
class Message:
    """聊天消息"""
    role: str  # system | user | assistant | tool
    content: str


@dataclass(frozen=True)
class ProviderConfig:
    """提供商配置，支持任意 OpenAI 兼容 API（Ollama / vLLM / DeepSeek …）"""
    api_key: str = ""
    model: str = "gpt-4o-mini"
    base_url: str | None = None
    max_tokens: int = 4096
    temperature: float = 0.7
    verify_ssl: bool = True


class OpenAIProvider:
    """OpenAI 兼容格式提供商"""

    def __init__(self, config: ProviderConfig | None = None):
        self.config = config or ProviderConfig()
        api_key = self.config.api_key or os.environ.get("OPENAI_API_KEY", "unused")
        http_client = httpx.AsyncClient(verify=self.config.verify_ssl)
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=self.config.base_url,
            http_client=http_client,
        )

    async def chat(
        self,
        messages: list[Message],
        tools: list[dict] | None = None,
    ) -> AsyncGenerator[Event, None]:
        """流式调用 LLM，yield TextDelta / ToolCall"""
        kwargs: dict = dict(
            model=self.config.model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            stream=True,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
        )
        if tools:
            kwargs["tools"] = tools

        stream = await self._client.chat.completions.create(**kwargs)
        tool_fragments: dict[int, dict] = {}

        async for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta

            # 文本流
            if delta.content:
                yield TextDelta(content=delta.content)

            # 工具调用片段累积
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    frag = tool_fragments.setdefault(
                        tc.index, {"id": "", "name": "", "arguments": ""},
                    )
                    if tc.id:
                        frag["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            frag["name"] += tc.function.name
                        if tc.function.arguments:
                            frag["arguments"] += tc.function.arguments

            # 流结束 — 发射累积的工具调用
            if choice.finish_reason == "tool_calls":
                for frag in tool_fragments.values():
                    yield ToolCall(
                        name=frag["name"],
                        arguments=frag["arguments"],
                        tool_call_id=frag["id"] or None,
                    )
                tool_fragments.clear()
