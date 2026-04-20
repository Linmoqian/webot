"""极简工具注册与执行"""
from __future__ import annotations

import inspect
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from agent import ToolResult

ToolHandler = Callable[[dict[str, Any]], str | Awaitable[str]]


@dataclass(frozen=True)
class ToolDef:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, ToolDef] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        handler: ToolHandler,
    ) -> None:
        self._tools[name] = ToolDef(
            name=name,
            description=description,
            parameters=parameters,
            handler=handler,
        )

    def get_tool_schemas(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            }
            for tool in self._tools.values()
        ]

    async def execute(self, name: str, arguments: str) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(name=name, output=f"未知工具: {name}", success=False)

        try:
            parsed = json.loads(arguments or "{}")
            if not isinstance(parsed, dict):
                raise ValueError("arguments 必须是 JSON object")
        except Exception as exc:
            return ToolResult(name=name, output=f"参数解析失败: {exc}", success=False)

        try:
            output = tool.handler(parsed)
            if inspect.isawaitable(output):
                output = await output
            return ToolResult(name=name, output=str(output), success=True)
        except Exception as exc:
            return ToolResult(name=name, output=f"工具执行失败: {exc}", success=False)
