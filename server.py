"""轻量 HTTP API 服务，作为 Tauri sidecar 入口。"""

from __future__ import annotations

import json
import os
import asyncio
import uuid
from dataclasses import dataclass
from typing import AsyncGenerator

from aiohttp import web
import httpx


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

from agent import Agent, TextDelta, ThinkingDelta, ToolCall, ToolResult
from config.providers import OpenAIProvider
from config.settings import load_settings
from skills import ToolRegistry
from tools import register_builtin_tools
from session.wechat_bot.protocol import WeChatProtocol
from session.wechat_bot.types import WeChatConfig

# ── 全局 Agent 实例 ──────────────────────────────────────────────

agent: Agent | None = None
wechat_gateway_task: asyncio.Task | None = None


@dataclass
class WeChatQrSession:
    session_id: str
    qrcode_id: str
    scan_url: str
    base_url: str
    created_at: float
    status: str = "pending"
    token: str = ""


wechat_qr_sessions: dict[str, WeChatQrSession] = {}


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


def _state_file_path() -> str:
    settings = load_settings()
    state_dir = settings.wechat.state_dir or "./config/wechat_state"
    return os.path.join(state_dir, "account.json")


def _has_saved_token() -> bool:
    state_file = _state_file_path()
    if not os.path.exists(state_file):
        return False
    try:
        with open(state_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return bool((data.get("token") or "").strip())
    except Exception:
        return False


async def wechat_status(_request: web.Request) -> web.Response:
    gateway_running = bool(wechat_gateway_task and not wechat_gateway_task.done())
    return web.json_response(
        {
            "connected": _has_saved_token(),
            "gateway_running": gateway_running,
        }
    )


async def wechat_qr(_request: web.Request) -> web.Response:
    settings = load_settings()
    w = settings.wechat
    cfg = WeChatConfig(
        base_url=w.base_url,
        verify_ssl=w.verify_ssl,
        state_dir=w.state_dir,
        poll_timeout=w.poll_timeout,
    )
    protocol = WeChatProtocol(cfg)
    protocol.client = httpx.AsyncClient(
        timeout=httpx.Timeout(30, connect=15),
        follow_redirects=True,
        verify=cfg.verify_ssl,
    )
    try:
        qrcode_id, scan_url = await protocol._fetch_qr()  # noqa: SLF001
    finally:
        await protocol.client.aclose()
        protocol.client = None

    sid = str(uuid.uuid4())
    wechat_qr_sessions[sid] = WeChatQrSession(
        session_id=sid,
        qrcode_id=qrcode_id,
        scan_url=scan_url,
        base_url=cfg.base_url,
        created_at=asyncio.get_event_loop().time(),
    )
    return web.json_response({"session_id": sid, "scan_url": scan_url, "qrcode_id": qrcode_id})


async def wechat_qr_status(request: web.Request) -> web.Response:
    session_id = (request.query.get("session_id") or "").strip()
    if not session_id or session_id not in wechat_qr_sessions:
        return web.json_response({"error": "invalid session_id"}, status=400)
    session = wechat_qr_sessions[session_id]
    if session.status == "confirmed":
        return web.json_response({"status": "confirmed"})

    settings = load_settings()
    w = settings.wechat
    cfg = WeChatConfig(
        base_url=w.base_url,
        verify_ssl=w.verify_ssl,
        state_dir=w.state_dir,
        poll_timeout=w.poll_timeout,
    )
    protocol = WeChatProtocol(cfg)
    protocol.client = httpx.AsyncClient(
        timeout=httpx.Timeout(15, connect=10),
        follow_redirects=True,
        verify=cfg.verify_ssl,
    )
    try:
        data = await protocol._get(  # noqa: SLF001
            "ilink/bot/get_qrcode_status",
            params={"qrcode": session.qrcode_id},
            auth=False,
            base_url=session.base_url,
        )
    finally:
        await protocol.client.aclose()
        protocol.client = None

    status = data.get("status", "unknown")
    session.status = status
    if status == "confirmed":
        token = (data.get("bot_token") or "").strip()
        base_url = (data.get("baseurl") or session.base_url).strip()
        if token:
            state_dir = cfg.resolved_state_dir
            state_dir.mkdir(parents=True, exist_ok=True)
            state_file = state_dir / "account.json"
            state_file.write_text(
                json.dumps(
                    {
                        "token": token,
                        "get_updates_buf": "",
                        "context_tokens": {},
                        "base_url": base_url,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            session.token = token
    if status == "scaned_but_redirect":
        redirect = str(data.get("redirect_host", "") or "").strip()
        if redirect:
            session.base_url = redirect if redirect.startswith("http") else f"https://{redirect}"
    return web.json_response({"status": status})


async def _run_gateway() -> None:
    from wechat_gateway import main as gateway_main
    await gateway_main()


async def wechat_gateway_start(_request: web.Request) -> web.Response:
    global wechat_gateway_task
    if wechat_gateway_task and not wechat_gateway_task.done():
        return web.json_response({"ok": True, "running": True})
    wechat_gateway_task = asyncio.create_task(_run_gateway())
    return web.json_response({"ok": True, "running": True})


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
                case ThinkingDelta(content=content):
                    await _sse(resp, "thinking", {"content": content})
                case ToolCall(name=name, arguments=arguments):
                    await _sse(resp, "tool_call", {"name": name, "arguments": arguments})
                case ToolResult(name=name, output=output, success=success):
                    await _sse(resp, "tool_result", {"name": name, "output": output, "success": success})
        await _sse(resp, "done", {})
    except ConnectionResetError:
        return resp
    except Exception as exc:
        try:
            await _sse(resp, "error", {"message": str(exc)})
        except ConnectionResetError:
            pass

    try:
        await resp.write_eof()
    except ConnectionResetError:
        pass
    return resp


# ── 启动 ────────────────────────────────────────────────────────

def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/health", health)
    app.router.add_post("/chat", chat)
    app.router.add_get("/wechat/status", wechat_status)
    app.router.add_post("/wechat/qr", wechat_qr)
    app.router.add_get("/wechat/qr_status", wechat_qr_status)
    app.router.add_post("/wechat/gateway/start", wechat_gateway_start)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("WEBOT_PORT", 18180))
    print(f"\033[32m[server] 监听 http://127.0.0.1:{port}\033[0m")
    web.run_app(create_app(), host="127.0.0.1", port=port, print=None)
