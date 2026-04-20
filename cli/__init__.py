"""webot CLI — 超轻量化 Agent 终端界面

prompt_toolkit (输入) + Rich (渲染) + asyncio (协调)
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import AsyncGenerator

from prompt_toolkit import PromptSession
from prompt_toolkit.history import FileHistory
from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.syntax import Syntax

from agent import Agent, AgentProtocol, Event, TextDelta, ToolCall, ToolResult
from config.providers import OpenAIProvider
from skills import ToolRegistry

# ── 常量 ─────────────────────────────────────────────────────

HISTORY_PATH = "~/.webot_history"
WELCOME = "[bold cyan]webot[/] — 超轻量 Agent 框架  [dim]输入 help 查看命令[/]"
PROMPT_STR = "[bold cyan]›[/] "
CONTINUE_STR = "[dim]…[/] "
EXIT_WORDS = frozenset({"exit", "quit", "q"})


# ── 演示用 Agent ─────────────────────────────────────────────

class DummyAgent:
    """模拟流式响应与工具调用，用于测试"""

    async def process(self, message: str) -> AsyncGenerator[Event, None]:
        yield ToolCall(name="search", arguments='{"query": "' + message + '"}')
        await asyncio.sleep(0.3)
        yield ToolResult(name="search", output="找到 3 个结果")
        await asyncio.sleep(0.2)

        words = (
            f"关于 **{message}**，以下是搜索结果：\n\n"
            "1. 第一个结果\n2. 第二个结果\n3. 第三个结果\n\n"
            "```python\nprint('hello webot')\n```\n"
        )
        for char in words:
            yield TextDelta(content=char)
            await asyncio.sleep(0.01)


# ── CLI ──────────────────────────────────────────────────────

class CLI:
    def __init__(self, agent: AgentProtocol | None = None):
        self.agent = agent or self._build_default_agent()
        self.console = Console()
        self._active_task: asyncio.Task[None] | None = None
        self.session: PromptSession = PromptSession(
            history=FileHistory(os.path.expanduser(HISTORY_PATH)),
        )

    def _build_default_agent(self) -> AgentProtocol:
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
        return Agent(provider=OpenAIProvider(), tools=tools)

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
            if self._active_task and self._active_task.done():
                await self._active_task
                self._active_task = None

            try:
                text = await self._read_input()
            except (KeyboardInterrupt, EOFError):
                if self._active_task and not self._active_task.done():
                    self._active_task.cancel()
                return

            if not text:
                continue

            cmd = text.strip().lower()
            if cmd in EXIT_WORDS:
                if self._active_task and not self._active_task.done():
                    self._active_task.cancel()
                return
            if cmd == "help":
                self._show_help()
                continue
            if cmd == "clear":
                self.console.clear()
                self.console.print(WELCOME)
                continue

            if self._active_task is None:
                self._active_task = asyncio.create_task(self._stream_response(text))
                continue

            enqueue = getattr(self.agent, "enqueue", None)
            if callable(enqueue):
                enqueue(text)
                self.console.print("[dim]消息已进入 pending_queue[/]")
            else:
                self.console.print("[yellow]当前正在处理，请稍后重试[/]")

    # ── 输入 ─────────────────────────────────────────────

    async def _read_input(self) -> str:
        """读取用户输入，支持 \\ 续行"""
        lines: list[str] = []
        prompt = PROMPT_STR

        while True:
            line: str = await self.session.prompt_async(prompt)
            if line.endswith("\\"):
                lines.append(line[:-1])
                prompt = CONTINUE_STR
            else:
                lines.append(line)
                return "\n".join(lines)

    # ── 流式输出 ─────────────────────────────────────────

    async def _stream_response(self, message: str) -> None:
        """流式渲染 agent 响应，交替展示文本与工具调用"""
        buf = ""
        last_refresh = 0.0
        
        status = self.console.status("[dim]思考中...[/]", spinner="dots")
        status.start()
        status_running = True

        try:
            with Live("", console=self.console, auto_refresh=False, vertical_overflow="visible") as live:
                async for event in self.agent.process(message):
                    if isinstance(event, TextDelta):
                        if status_running:
                            status.stop()
                            status_running = False
                        buf += event.content
                        live.update(Markdown(buf))
                        now = time.monotonic()
                        if now - last_refresh >= 0.15:
                            live.refresh()
                            last_refresh = now
                    elif isinstance(event, ToolCall):
                        if buf:
                            live.update(Markdown(buf), refresh=True)
                            buf = ""
                        if status_running: 
                            status.stop()
                            status_running = False
                        live.stop()
                        self.console.print(self._render_tool_call(event))
                        status.start()
                        status_running = True
                        live.start()
                    elif isinstance(event, ToolResult):
                        if status_running:
                            status.stop()
                            status_running = False
                        live.stop()
                        self.console.print(self._render_tool_result(event))
                        status.start()
                        status_running = True
                        live.start()

                live.update(Markdown(buf), refresh=True)
        finally:
            if status_running:
                status.stop()

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
