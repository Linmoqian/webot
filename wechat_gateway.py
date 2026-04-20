"""WeChat gateway service.

Long-polls WeChat via session.wechat_bot and forwards user text to an
OpenAI-compatible model provider.

配置来源: config/settings/settings.json, 环境变量优先级更高
"""

from __future__ import annotations

import asyncio

from agent import Agent, TextDelta, ToolResult
from config.providers import OpenAIProvider

from config.settings import load_settings
from session.wechat_bot import WeChatBot, WeChatConfig, WeChatMessage
from skills import ToolRegistry
from tools import register_builtin_tools


async def main() -> None:
    settings = load_settings()
    p = settings.provider
    w = settings.wechat
    a = settings.agent

    wechat_cfg = WeChatConfig(
        base_url=w.base_url,
        verify_ssl=w.verify_ssl,
        state_dir=w.state_dir,
        poll_timeout=w.poll_timeout,
    )

    bot = WeChatBot(config=wechat_cfg)

    tools = ToolRegistry()
    register_builtin_tools(tools)

    # 每个微信用户使用独立 Agent，会话上下文不串线。
    user_agents: dict[str, Agent] = {}

    def get_user_agent(user_id: str) -> Agent:
        if user_id not in user_agents:
            provider = OpenAIProvider(p)
            user_agents[user_id] = Agent(
                provider=provider,
                tools=tools,
                system_prompt=a.system_prompt,
                max_context_messages=a.max_context_messages,
            )
        return user_agents[user_id]

    @bot.on_message
    async def handle(msg: WeChatMessage) -> str | None:
        text = (msg.text or "").strip()
        if not text:
            return "我目前只处理文本消息。"

        agent = get_user_agent(msg.user_id)
        reply_chunks: list[str] = []
        tool_results: list[str] = []

        try:
            async for event in agent.process(text):
                if isinstance(event, TextDelta):
                    reply_chunks.append(event.content)
                elif isinstance(event, ToolResult):
                    prefix = "工具成功" if event.success else "工具失败"
                    tool_results.append(f"{prefix}: {event.name} -> {event.output}")
        except Exception as exc:
            return f"模型网关调用失败: {exc}"

        content = "".join(reply_chunks).strip()
        if content:
            return content
        if tool_results:
            return "\n".join(tool_results)
        return "我暂时没有生成有效回复，请稍后再试。"

    print("[gateway] starting wechat long-poll gateway")
    print(f"[gateway] model provider: {p.model} @ {p.base_url}")

    await bot._run()  # noqa: SLF001


if __name__ == "__main__":
    asyncio.run(main())
