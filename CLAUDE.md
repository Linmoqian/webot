# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Webot — 超轻量化 agent 框架，集成了微信机器人能力。采用 Python 后端 + Tauri 2.x 桌面前端的混合架构。

## Architecture

```
Python Backend (aiohttp, port 18180)
  ├── server.py          → HTTP API + SSE 流式推送
  ├── wechat_gateway.py  → 微信长轮询网关（按用户创建 agent 实例）
  ├── weixin.py           → 微信协议逆向实现（ilinkai API）
  └── agent/config/session/skills/tools  → 核心模块（外部引入）

Tauri Desktop App (webot/)
  ├── src/App.tsx         → React 聊天界面，含思考链折叠展示
  ├── src/App.css         → CSS 变量驱动的现代 UI
  └── src-tauri/          → Rust 层（Tauri 2.x，目前仅有骨架代码）
```

前端通过 SSE (`POST /chat`) 与后端通信，事件类型：`text`、`thinking`、`tool_call`、`tool_result`、`done`、`error`。

## Commands

```bash
# Python 后端
python server.py                 # HTTP API 服务，端口 18180
python -m cli                    # 终端 REPL
python wechat_gateway.py         # 微信网关（首次需扫码）

# Tauri 前端（在 webot/ 目录下）
cd webot && npm run dev          # Vite 开发服务器（端口 1420）
cd webot && npm run tauri dev    # Tauri 完整开发模式
cd webot && npm run build        # TypeScript 编译 + Vite 构建
cd webot && npm run tauri build  # Tauri 生产构建
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | 健康检查 |
| POST | `/chat` | SSE 流式对话 |
| GET | `/wechat/status` | 微信连接状态 |
| POST | `/wechat/qr` | 获取微信登录二维码 |
| GET | `/wechat/qr_status?session_id=` | 轮询扫码状态 |
| POST | `/wechat/gateway/start` | 启动微信网关 |

## Key Technical Details

- SSE 数据格式：`event: <type>\ndata: <json>\n\n`，前端需用 `EventSource` 或 `fetch` + `ReadableStream` 解析
- 微信状态持久化到 `config/wechat_state/account.json`（token、base_url）
- 前端目前使用模拟数据（`simulateStream`），尚未接入真实后端 API
- Python 后端依赖：`aiohttp`、`httpx`；无 requirements.txt，通过 conda 环境管理
- Tauri CSP 已设为 `null`（开发阶段）

## Current State

项目处于早期原型阶段：前端聊天 UI 已成型但未连接后端，Python 核心模块（agent/config/session/skills/tools）通过 import 引用但不在本仓库内。
