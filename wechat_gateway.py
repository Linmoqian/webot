"""WeChat gateway service.

Long-polls WeChat via session.wechat_bot and forwards user text to an
OpenAI-compatible model provider.

配置来源: config/settings/settings.json, 环境变量优先级更高
"""

from __future__ import annotations

import asyncio
from collections import defaultdict

import httpx
from openai import AsyncOpenAI

from config.settings import load_settings
from session.wechat_bot import WeChatBot, WeChatConfig, WeChatMessage


async def main() -> None:
    settings = load_settings()
    p = settings.provider
    w = settings.wechat
    a = settings.agent

    llm_http = httpx.AsyncClient(verify=p.verify_ssl, timeout=httpx.Timeout(120, connect=30))
    llm = AsyncOpenAI(api_key=p.api_key, base_url=p.base_url, http_client=llm_http)

    wechat_cfg = WeChatConfig(
        base_url=w.base_url,
        verify_ssl=w.verify_ssl,
        state_dir=w.state_dir,
        poll_timeout=w.poll_timeout,
    )

    bot = WeChatBot(config=wechat_cfg)
    histories: dict[str, list[dict[str, str]]] = defaultdict(
        lambda: [{"role": "system", "content": a.system_prompt}]
    )

    @bot.on_message
    async def handle(msg: WeChatMessage) -> str | None:
        text = (msg.text or "").strip()
        if not text:
            return "我目前只处理文本消息。"

        h = histories[msg.user_id]
        h.append({"role": "user", "content": text})

        if len(h) > 1 + a.max_turns * 2:
            h[:] = [h[0], *h[-a.max_turns * 2:]]

        try:
            resp = await llm.chat.completions.create(
                model=p.model,
                messages=h,
                temperature=p.temperature,
                max_tokens=p.max_tokens,
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
    print(f"[gateway] model provider: {p.model} @ {p.base_url}")

    try:
        await bot._run()  # noqa: SLF001
    finally:
        await llm_http.aclose()


if __name__ == "__main__":
    asyncio.run(main())
