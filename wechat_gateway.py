"""WeChat gateway service.

Long-polls WeChat via session.wechat_bot and forwards user text to an
OpenAI-compatible model provider (default model: gemma4:e2B).

Env vars:
  LLM_BASE_URL       default: https://frp-van.com:25941/v1
  LLM_API_KEY        default: lm-studio
  LLM_MODEL          default: gemma4:e2B
  LLM_VERIFY_SSL     default: false
  LLM_MAX_TURNS      default: 20

  WECHAT_BASE_URL    default: https://ilinkai.weixin.qq.com
  WECHAT_VERIFY_SSL  default: true
  WECHAT_STATE_DIR   default: ./wechat_state
  WECHAT_POLL_TIMEOUT default: 35
"""

from __future__ import annotations

import asyncio
import os
from collections import defaultdict

import httpx
from openai import AsyncOpenAI

from session.wechat_bot import WeChatBot, WeChatConfig, WeChatMessage


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value)
    except Exception:
        return default


async def main() -> None:
    llm_base_url = os.environ.get("LLM_BASE_URL", "https://frp-van.com:25941/v1").rstrip("/")
    llm_api_key = os.environ.get("LLM_API_KEY", "lm-studio")
    llm_model = os.environ.get("LLM_MODEL", "gemma4:e2B")
    llm_verify_ssl = _env_bool("LLM_VERIFY_SSL", False)
    llm_max_turns = _env_int("LLM_MAX_TURNS", 20)

    wechat_cfg = WeChatConfig(
        base_url=os.environ.get("WECHAT_BASE_URL", "https://ilinkai.weixin.qq.com").rstrip("/"),
        verify_ssl=_env_bool("WECHAT_VERIFY_SSL", True),
        state_dir=os.environ.get("WECHAT_STATE_DIR", "./wechat_state"),
        poll_timeout=_env_int("WECHAT_POLL_TIMEOUT", 35),
    )

    llm_http = httpx.AsyncClient(verify=llm_verify_ssl, timeout=httpx.Timeout(120, connect=30))
    llm = AsyncOpenAI(api_key=llm_api_key, base_url=llm_base_url, http_client=llm_http)

    bot = WeChatBot(config=wechat_cfg)
    histories: dict[str, list[dict[str, str]]] = defaultdict(
        lambda: [{"role": "system", "content": "你是一个简洁可靠的微信助手。"}]
    )

    @bot.on_message
    async def handle(msg: WeChatMessage) -> str | None:
        text = (msg.text or "").strip()
        if not text:
            return "我目前只处理文本消息。"

        h = histories[msg.user_id]
        h.append({"role": "user", "content": text})

        if len(h) > 1 + llm_max_turns * 2:
            h[:] = [h[0], *h[-llm_max_turns * 2 :]]

        try:
            resp = await llm.chat.completions.create(
                model=llm_model,
                messages=h,
                temperature=0.7,
                stream=False,
            )
            content = (resp.choices[0].message.content or "").strip()
            if not content:
                content = "我暂时没有生成有效回复，请稍后再试。"
        except Exception as exc:
            content = f"模型网关调用失败: {exc}"

        h.append({"role": "assistant", "content": content})
        return content

    print("[gateway] starting wechat long-poll gateway")
    print(f"[gateway] model provider: {llm_model} @ {llm_base_url}")

    try:
        await bot._run()  # noqa: SLF001
    finally:
        await llm_http.aclose()


if __name__ == "__main__":
    asyncio.run(main())
