# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Webot — 超轻量化 agent 框架。Tauri 2.x 桌面应用，Rust 后端直接调用 OpenAI 兼容 LLM API，React 前端展示对话。

## Architecture

```
webot/
├── src/                          # React 前端
│   ├── App.tsx                   → 聊天界面（invoke + listen 通信）
│   ├── App.css                   → CSS 暗色主题通过 [data-theme="dark"] 切换
│   ├── i18n.tsx                  → 国际化（中/英），useI18n hook + I18nProvider
│   └── main.tsx                  → React 入口，I18nProvider 包裹 App
├── src-tauri/                    # Rust 后端（Tauri 2.x）
│   └── src/
│       ├── lib.rs                → 应用入口，注册命令和状态
│       ├── commands.rs           → Tauri 命令（start_chat, get_settings）
│       ├── llm.rs                → SSE 流式请求 LLM API，emit 事件到前端
│       ├── config.rs             → 从 config.json 加载配置
│       └── main.rs               → 程序入口
└── config.json                   → LLM 配置（base_url, model, api_key, system_prompt）
```

### 通信流程

```
React 前端
  → invoke("start_chat", { message })
Rust 后端（commands.rs）
  → tokio::spawn → llm.rs stream_and_emit()
  → POST {base_url}/chat/completions（SSE 流式）
  → 解析 delta → emit("chat-thinking" / "chat-text" / "chat-done" / "chat-error")
React 前端
  → listen() 接收事件，实时更新 UI
```

### 事件类型

| Event | Payload | 说明 |
|-------|---------|------|
| `chat-thinking` | `{ content }` | 思维链内容（reasoning_content） |
| `chat-text` | `{ content }` | 正文内容 |
| `chat-done` | `{}` | 完成 |
| `chat-error` | `{ message }` | 错误 |

## Commands

```bash
# 开发
cd webot && npm run dev          # Vite 开发服务器（端口 1420）
cd webot && npm run tauri dev    # Tauri 完整开发模式

# 构建
cd webot && npm run build        # TypeScript 编译 + Vite 构建
cd webot && npm run tauri build  # Tauri 生产构建
```

## Key Technical Details

- 前端通过 `@tauri-apps/api` 的 `invoke` / `listen` 与 Rust 后端通信
- Rust 后端用 `reqwest` + `futures_util` 处理 SSE 流式响应
- 支持 `reasoning_content` 字段（思维链），前端可折叠展示
- 前端 Markdown 渲染：react-markdown + remark-gfm + remark-math + rehype-highlight + rehype-katex
- 配置文件 `config.json` 支持多路径查找（当前目录 → ../ → ../../）
- `danger_accept_invalid_certs(true)` 用于开发环境跳过 SSL 验证
- 国际化：`src/i18n.tsx` 提供中/英翻译字典，通过 `useI18n()` hook 的 `t()` 函数访问
- 主题切换：通过 `document.documentElement.setAttribute("data-theme", ...)` 实现，CSS 用 `[data-theme="dark"]` 选择器覆盖暗色样式，偏好存 localStorage

## Current State

前后端已连通，可进行完整对话。核心功能：流式对话、思维链展示、Markdown 渲染（含代码高亮和 LaTeX）、主题切换（浅色/深色/跟随系统）、中英文切换。
