# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目目标

超轻量化 Agent 框架。核心循环：调用 LLM → 解析工具 → 执行 → 回传结果。

## 运行

```bash
python -m cli                              # 启动终端 REPL
OPENAI_API_KEY=xxx python -m cli           # 带 API Key 启动
```

依赖：`pip install prompt_toolkit rich openai`

## 架构

数据流全链路基于 `Event` 异步生成器，模块间零耦合：

```
用户 → CLI (prompt_toolkit 输入 / Rich 流式渲染)
         ↓
      Agent (循环：调 LLM → 解析工具 → 执行 → 回传)
         ↓               ↑
      Provider           Skills
   (OpenAI 格式)      (工具注册/执行)
```

**Event 类型** (`agent/__init__.py`) 是贯穿所有模块的核心协议：

- `TextDelta` — LLM 文本流片段
- `ToolCall` — 工具调用（name + arguments JSON）
- `ToolResult` — 工具执行结果
- `AgentProtocol` — `async def process(message) -> AsyncGenerator[Event, None]`

**Provider** (`providers/__init__.py`)：`OpenAIProvider.chat(messages, tools) -> AsyncGenerator[Event, None]`，支持任意 OpenAI 兼容 API（设 `base_url` 即可适配 Ollama / vLLM / DeepSeek）。

**CLI** (`cli/__init__.py`)：`CLI` 类消费 `AgentProtocol`，用 `Rich Live` 流式渲染 Markdown，`\` 续行，`FileHistory` 持久化历史。

## 待实现

- `skills/` — 工具/技能定义与注册
- `config/` — 配置管理
- `session/` — 会话状态管理（上下文、历史）
- `agent/` 核心循环 — 连接 Provider + Skills 的 agent loop
