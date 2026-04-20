"""wechat_bot — Standalone WeChat personal bot module.

Copy this entire directory into any project to add WeChat support.

Quick start:
    # If copied out as top-level package:
    from wechat_bot import WeChatBot, WeChatMessage

    # If used directly inside this repository:
    from session.wechat_bot import WeChatBot, WeChatMessage

    bot = WeChatBot()

    @bot.on_message
    async def handle(msg: WeChatMessage) -> str | None:
        if msg.text:
            return f"You said: {msg.text}"
        return None

    bot.run()

Dependencies:
    pip install httpx pycryptodome qrcode
"""

from .bot import WeChatBot
from .types import WeChatConfig, WeChatMessage

__all__ = ["WeChatBot", "WeChatMessage", "WeChatConfig"]
__version__ = "1.0.0"
