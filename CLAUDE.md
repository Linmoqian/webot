# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目目标

超轻量化 Agent 框架。核心循环：调用 LLM → 解析工具 → 执行 → 回传结果。

## 运行

```bash
python server.py                            # HTTP API 服务（端口 18180）
python wechat_gateway.py                    # 微信网关（首次扫码登录）
npm run tauri dev                           # Tauri 桌面客户端（需先启动 server.py）
```

Python 依赖：`pip install aiohttp openai httpx qrcode pycryptodome`
前端依赖：`npm install`

## 架构

```
Tauri 桌面窗口 (Svelte UI)
    ↕ HTTP SSE (localhost:18180)
server.py (aiohttp)
    ↓
Agent (循环：调 LLM → 解析工具 → 执行 → 回传)
    ↓               ↑
Provider           Skills
(OpenAI 兼容)    (工具注册/执行)
```

### 核心模块

**Event 协议** (`agent/__init__.py`) — 贯穿所有模块的核心类型：

- `TextDelta` — LLM 文本流片段
- `ToolCall` — 工具调用（name + arguments JSON）
- `ToolResult` — 工具执行结果
- `Agent.process(message) -> AsyncGenerator[Event, None]` — 唯一公共接口

**Provider** (`config/providers/__init__.py`)：`OpenAIProvider.chat(messages, tools)` → 流式 yield Event。支持任意 OpenAI 兼容 API（`base_url` 适配 Ollama / vLLM / DeepSeek）。

**Skills** (`skills/__init__.py`)：`ToolRegistry` 注册/执行工具，生成 JSON Schema。

**Tools** (`tools/builtin.py`)：内置工具（search / get_weather / take_screenshot），通过 `register_builtin_tools(registry)` 批量注册。

**HTTP API** (`server.py`)：aiohttp 服务，`POST /chat` 返回 SSE 流式响应，`GET /health` 健康检查。端口由 `WEBOT_PORT` 环境变量控制（默认 18180）。

### 配置

**统一配置** (`config/settings/settings.json`)：provider / wechat / agent 三组配置。环境变量优先级高于 JSON 文件（见 `config/settings/__init__.py` 中的 `LLM_*` / `WECHAT_*` / `AGENT_*` 前缀）。

### 前端

Tauri 2 + SvelteKit + TypeScript。`src/` 为前端代码，`src-tauri/` 为 Rust 桌面壳。前端通过 `src/lib/api.ts` 与 Python 后端 SSE 通信。

### 微信渠道

`session/wechat_bot/` — 独立的微信个人号 Bot 模块，通过 ilinkai.weixin.qq.com API 长轮询收发消息。Gateway 为每个用户创建独立 Agent 实例，会话不串线。

### 依赖层次

```
agent  ← config/providers ← config/settings
agent  ← skills
tools/builtin → tools (独立，无项目内依赖)

server.py (入口，依赖 agent/config/skills/tools)
session/wechat_bot/ (独立模块，仅被 wechat_gateway.py 使用)
```

## 入口

| 入口 | 场景 | 说明 |
|------|------|------|
| `python server.py` | HTTP API | SSE 流式响应，Tauri 前端连接 |
| `python wechat_gateway.py` | 微信对话 | 每用户独立 Agent，非流式收集后回复 |
| `npm run tauri dev` | 桌面客户端 | 需先启动 server.py |

## 当前状态

- 无测试、无 requirements.txt / pyproject.toml
- `weixin.py` 是外部 nanobot 框架的参考代码，不参与项目运行
- `artifacts/` 存放运行截图，已被 .gitignore 排除
