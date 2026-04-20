"""webot CLI — 超轻量化 Agent 终端界面

prompt_toolkit (输入) + Rich (渲染) + asyncio (协调)
"""
from __future__ import annotations

import asyncio
import os

from prompt_toolkit import PromptSession
from prompt_toolkit.history import FileHistory
from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.syntax import Syntax

from agent import Agent, AgentProtocol, Event, TextDelta, ToolCall, ToolResult
from config.providers import OpenAIProvider
from config.settings import load_settings
from skills import ToolRegistry

# ── 常量 ─────────────────────────────────────────────────────

HISTORY_PATH = "~/.webot_history"
WELCOME = "[bold cyan]webot[/] — 超轻量 Agent 框架  [dim]输入 help 查看命令[/]"
PROMPT_STR = "你："
CONTINUE_STR = "... "
EXIT_WORDS = frozenset({"exit", "quit", "q"})


# ── CLI ──────────────────────────────────────────────────────

class CLI:
    def __init__(self, agent: AgentProtocol | None = None):
        self.agent = agent or self._build_default_agent()
        self.console = Console()
        self.session: PromptSession = PromptSession(
            history=FileHistory(os.path.expanduser(HISTORY_PATH)),
        )

    def _build_default_agent(self) -> AgentProtocol:
        settings = load_settings()
        tools = ToolRegistry()
        tools.register(
            name="search",
            description="简单搜索工具",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                },
                "required": ["query"],
            },
            handler=lambda args: f"搜索结果: {args.get('query', '')}",
        )
        provider = OpenAIProvider(settings.provider)
        return Agent(
            provider=provider,
            tools=tools,
            system_prompt=settings.agent.system_prompt,
            max_context_messages=settings.agent.max_context_messages,
        )

    # ── 公开接口 ─────────────────────────────────────────

    def run(self) -> None:
        self.console.print(WELCOME)
        try:
            asyncio.run(self._loop())
        except KeyboardInterrupt:
            pass
        self.console.print("[dim]再见[/]")

    # ── REPL 主循环 ──────────────────────────────────────

    async def _loop(self) -> None:
        while True:
            try:
                text = await self._read_input()
            except (KeyboardInterrupt, EOFError):
                return

            if not text:
                continue

            cmd = text.strip().lower()
            if cmd in EXIT_WORDS:
                return
            if cmd == "help":
                self._show_help()
                continue
            if cmd == "clear":
                self.console.clear()
                self.console.print(WELCOME)
                continue

            await self._stream_response(text)

    # ── 输入 ─────────────────────────────────────────────

    async def _read_input(self) -> str:
        """读取用户输入，支持 \\ 续行"""
        lines: list[str] = []
        current_prompt = PROMPT_STR

        while True:
            line: str = await self.session.prompt_async(current_prompt)
            if line.endswith("\\"):
                lines.append(line[:-1])
                current_prompt = CONTINUE_STR
            else:
                lines.append(line)
                return "\n".join(lines)

    # ── 流式输出 ─────────────────────────────────────────

    async def _stream_response(self, message: str) -> None:
        """流式渲染 agent 响应，交替展示文本与工具调用"""
        buf = ""
        with Live("", console=self.console, refresh_per_second=10, vertical_overflow="visible") as live:
            async for event in self.agent.process(message):
                if isinstance(event, TextDelta):
                    buf += event.content
                    live.update(Markdown(buf))
                elif isinstance(event, ToolCall):
                    if buf:
                        live.update(Markdown(buf), refresh=True)
                        buf = ""
                    live.stop()
                    self.console.print(self._render_tool_call(event))
                    live.start()
                elif isinstance(event, ToolResult):
                    live.stop()
                    self.console.print(self._render_tool_result(event))
                    live.start()

            if buf:
                live.update(Markdown(buf), refresh=True)

        if buf:
            self.console.print()

    # ── 工具渲染 ─────────────────────────────────────────

    def _render_tool_call(self, call: ToolCall) -> Panel:
        body = Syntax(call.arguments, "json", theme="monokai", line_numbers=False)
        return Panel(
            body,
            title=f"[bold yellow]⟳ {call.name}[/]",
            border_style="yellow",
            padding=(0, 1),
        )

    def _render_tool_result(self, result: ToolResult) -> Panel:
        color = "green" if result.success else "red"
        icon = "✓" if result.success else "✗"
        body = Syntax(result.output, "text", theme="monokai", line_numbers=False)
        return Panel(
            body,
            title=f"[bold {color}]{icon} {result.name}[/]",
            border_style=color,
            padding=(0, 1),
        )

    # ── 帮助 ─────────────────────────────────────────────

    def _show_help(self) -> None:
        self.console.print(
            "\n[bold]命令:[/]\n"
            "  [cyan]help[/]   显示帮助\n"
            "  [cyan]clear[/]  清屏\n"
            "  [cyan]exit[/]   退出 (quit, q, Ctrl+D)\n"
            "  [dim]输入末尾加 \\ 可续行[/]\n",
        )


# ── 入口 ─────────────────────────────────────────────────────

def main() -> None:
    cli = CLI()
    cli.run()
