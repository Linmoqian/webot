"""轻量 HTTP API 服务，作为 Tauri sidecar 入口。"""

from __future__ import annotations

import json
import os

from aiohttp import web

from config.providers import OpenAIProvider, TextDelta
from config.settings import load_settings


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


provider: OpenAIProvider | None = None
chat_messages: list[dict] = []


def _init_provider() -> OpenAIProvider:
    return OpenAIProvider(load_settings().provider)


async def _sse(response: web.StreamResponse, event: str, data: dict) -> None:
    await response.write(f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode())


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})


async def chat(request: web.Request) -> web.StreamResponse:
    body = await request.json()
    message = body.get("message", "").strip()
    if not message:
        return web.json_response({"error": "message is required"}, status=400)

    global provider, chat_messages
    if provider is None:
        provider = _init_provider()

    settings = load_settings()
    chat_messages.append({"role": "user", "content": message})
    max_msgs = settings.agent.max_context_messages
    if len(chat_messages) > max_msgs:
        chat_messages = chat_messages[-max_msgs:]

    all_messages = [{"role": "system", "content": settings.agent.system_prompt}] + chat_messages

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
        full_response: list[str] = []
        async for event in provider.chat_stream(all_messages):
            if isinstance(event, TextDelta):
                await _sse(resp, "text", {"content": event.content})
                full_response.append(event.content)
        chat_messages.append({"role": "assistant", "content": "".join(full_response)})
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


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/health", health)
    app.router.add_post("/chat", chat)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("WEBOT_PORT", 18180))
    print(f"\033[32m[server] 监听 http://127.0.0.1:{port}\033[0m")
    web.run_app(create_app(), host="127.0.0.1", port=port, print=None)
