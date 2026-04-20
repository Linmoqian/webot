"""Agent 协议与事件定义"""
from __future__ import annotations

import inspect
from collections import deque
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Awaitable, Callable, Literal, Protocol, Union, runtime_checkable


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


HookName = Literal["pre_llm", "post_llm", "pre_tool", "post_tool"]
HookPayload = dict[str, Any]
Hook = Callable[[HookPayload], HookPayload | None | Awaitable[HookPayload | None]]


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
        self._pending_queue: deque[str] = deque()
        self._hooks: dict[HookName, list[Hook]] = {
            "pre_llm": [],
            "post_llm": [],
            "pre_tool": [],
            "post_tool": [],
        }

    def register_hook(self, hook_name: HookName, hook: Hook) -> None:
        self._hooks[hook_name].append(hook)

    def enqueue(self, message: str) -> None:
        self._pending_queue.append(message)

    async def _run_hooks(self, hook_name: HookName, payload: HookPayload) -> HookPayload:
        current_payload = payload
        for hook in self._hooks[hook_name]:
            try:
                output = hook(current_payload)
                if inspect.isawaitable(output):
                    output = await output
                if output is not None:
                    current_payload = output
            except Exception as exc:
                print(f"[hook:{hook_name}] {exc}")
        return current_payload

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

    def _drain_pending(self) -> bool:
        drained_any = False
        while self._pending_queue:
            pending = self._pending_queue.popleft()
            self._append_message("user", pending)
            drained_any = True
        return drained_any

    async def process(self, message: str) -> AsyncGenerator[Event, None]:
        self._append_message("user", message)

        while True:
            prepared_messages = self._prepare_messages_for_llm()
            pre_payload = await self._run_hooks(
                "pre_llm",
                {"messages": prepared_messages},
            )
            llm_messages = pre_payload.get("messages", prepared_messages)

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

                    tool_payload = await self._run_hooks(
                        "pre_tool",
                        {
                            "name": event.name,
                            "arguments": event.arguments,
                            "tool_call_id": event.tool_call_id,
                        },
                    )
                    tool_result = await self.tools.execute(
                        name=str(tool_payload.get("name", event.name)),
                        arguments=str(tool_payload.get("arguments", event.arguments)),
                    )
                    await self._run_hooks(
                        "post_tool",
                        {
                            "name": tool_result.name,
                            "output": tool_result.output,
                            "success": tool_result.success,
                        },
                    )

                    self._append_message(
                        "assistant",
                        f"tool_call name={event.name} arguments={event.arguments}",
                    )
                    self._append_message("tool", tool_result.output)
                    yield tool_result

                    self._drain_pending()

            assistant_text = "".join(assistant_chunks)
            self._append_message("assistant", assistant_text)
            await self._run_hooks(
                "post_llm",
                {
                    "assistant_text": assistant_text,
                    "messages": self._messages,
                },
            )

            drained = self._drain_pending()
            if not saw_tool_call and not drained:
                break


@runtime_checkable
class AgentProtocol(Protocol):
    """Agent 必须实现的接口"""
    async def process(self, message: str) -> AsyncGenerator[Event, None]:
        ...
