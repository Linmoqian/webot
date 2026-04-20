"""Agent 协议与事件定义"""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncGenerator, Protocol, Union


@dataclass
class TextDelta:
    """LLM 文本流片段"""
    content: str


@dataclass
class ToolCall:
    """工具调用事件"""
    name: str
    arguments: str
    tool_call_id: str | None = None


@dataclass
class ToolResult:
    """工具执行结果"""
    name: str
    output: str
    success: bool = True


Event = Union[TextDelta, ToolCall, ToolResult]


@dataclass(frozen=True)
class ChatMessage:
    """Agent 内部消息结构"""
    role: str
    content: str


class ProviderProtocol(Protocol):
    """LLM 提供商协议"""

    async def chat(
        self,
        messages: list[ChatMessage],
        tools: list[dict] | None = None,
    ) -> AsyncGenerator[Event, None]:
        ...


class ToolExecutorProtocol(Protocol):
    """工具执行协议"""

    def get_tool_schemas(self) -> list[dict]:
        ...

    async def execute(self, name: str, arguments: str) -> ToolResult:
        ...


class Agent:
    """最小可用 Agent Loop：LLM -> 工具 -> 回填 -> 继续"""

    def __init__(
        self,
        provider: ProviderProtocol,
        tools: ToolExecutorProtocol,
        *,
        system_prompt: str = "你是一个简洁可靠的 AI 助手。",
        max_context_messages: int = 20,
    ):
        self.provider = provider
        self.tools = tools
        self.max_context_messages = max_context_messages
        self._messages: list[ChatMessage] = [ChatMessage(role="system", content=system_prompt)]

    def _prepare_messages_for_llm(self) -> list[ChatMessage]:
        system_msg = next((item for item in self._messages if item.role == "system"), None)
        recent_non_system = [item for item in self._messages if item.role != "system"]
        clipped = recent_non_system[-self.max_context_messages :]
        if system_msg is None:
            return clipped
        return [system_msg, *clipped]

    def _append_message(self, role: str, content: str) -> None:
        if content:
            self._messages.append(ChatMessage(role=role, content=content))

    async def process(self, message: str) -> AsyncGenerator[Event, None]:
        self._append_message("user", message)

        while True:
            llm_messages = self._prepare_messages_for_llm()
            assistant_chunks: list[str] = []
            saw_tool_call = False

            async for event in self.provider.chat(
                llm_messages,
                tools=self.tools.get_tool_schemas() or None,
            ):
                if isinstance(event, TextDelta):
                    assistant_chunks.append(event.content)
                    yield event
                    continue

                if isinstance(event, ToolCall):
                    saw_tool_call = True
                    yield event

                    tool_result = await self.tools.execute(
                        name=event.name,
                        arguments=event.arguments,
                    )
                    
                    self._append_message(
                        "assistant",
                        f"tool_call name={event.name} arguments={event.arguments}",
                    )
                    self._append_message("tool", tool_result.output)
                    yield tool_result

            assistant_text = "".join(assistant_chunks)
            if assistant_text:
                self._append_message("assistant", assistant_text)

            # 如果没有看到新的工具调用，说明回合结束
            if not saw_tool_call:
                break
