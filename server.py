"""轻量 HTTP API 服务，作为 Tauri sidecar 入口。"""

from __future__ import annotations

import json
import os
from typing import AsyncGenerator

from aiohttp import web


# ── CORS 中间件 ─────────────────────────────────────────────────

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


@web.middleware
async def cors_middleware(request: web.Request, handler: object) -> web.StreamResponse:
    if request.method == "OPTIONS":
        return web.Response(headers=CORS_HEADERS)
    resp = await handler(request)
    resp.headers.update(CORS_HEADERS)
    return resp

from agent import Agent, TextDelta, ToolCall, ToolResult
from config.providers import OpenAIProvider
from config.settings import load_settings
from skills import ToolRegistry
from tools import register_builtin_tools

# ── 全局 Agent 实例 ──────────────────────────────────────────────

agent: Agent | None = None


def _init_agent() -> Agent:
    settings = load_settings()
    p = settings.provider
    a = settings.agent
    tools = ToolRegistry()
    register_builtin_tools(tools)
    provider = OpenAIProvider(p)
    return Agent(
        provider=provider,
        tools=tools,
        system_prompt=a.system_prompt,
        max_context_messages=a.max_context_messages,
    )


# ── SSE 辅助 ────────────────────────────────────────────────────

async def _sse(response: web.StreamResponse, event: str, data: dict) -> None:
    await response.write(f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode())


# ── 路由 ────────────────────────────────────────────────────────

async def health(_request: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})


async def chat(request: web.Request) -> web.StreamResponse:
    body = await request.json()
    message = body.get("message", "").strip()
    if not message:
        return web.json_response({"error": "message is required"}, status=400)

    global agent
    if agent is None:
        agent = _init_agent()

    resp = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
    await resp.prepare(request)

    try:
        async for event in agent.process(message):
            match event:
                case TextDelta(content=content):
                    await _sse(resp, "text", {"content": content})
                case ToolCall(name=name, arguments=arguments):
                    await _sse(resp, "tool_call", {"name": name, "arguments": arguments})
                case ToolResult(name=name, output=output, success=success):
                    await _sse(resp, "tool_result", {"name": name, "output": output, "success": success})
        await _sse(resp, "done", {})
    except Exception as exc:
        await _sse(resp, "error", {"message": str(exc)})

    await resp.write_eof()
    return resp


# ── 启动 ────────────────────────────────────────────────────────

def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/health", health)
    app.router.add_post("/chat", chat)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("WEBOT_PORT", 18180))
    print(f"\033[32m[server] 监听 http://127.0.0.1:{port}\033[0m")
    web.run_app(create_app(), host="127.0.0.1", port=port, print=None)
