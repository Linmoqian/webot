# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Webot — 超轻量化 agent 桌面应用。Tauri 2.x (Rust) 后端直接调用 OpenAI 兼容 LLM API，React 前端展示对话。同时集成微信通道（ilinkai API），支持扫码登录、自动回复、媒体文件收发。内置插件市场和圆桌会议多 agent 讨论。

## Commands

```bash
cd webot
npm install              # 安装前端依赖
npm run dev              # Vite 开发服务器（端口 1420）
npm run tauri dev        # Tauri 完整开发模式（前端 + Rust 后端）
npm run build            # TypeScript 编译 + Vite 构建
npm run tauri build      # Tauri 生产构建
npm test                 # 前端测试（vitest）
npm run test:watch       # 前端测试监听模式
npm run test:rust        # Rust 后端测试（cargo test）
npm run test:all         # 前后端测试全部运行
```

首次运行前复制 `config.json` 并填入 LLM API 配置。

## Architecture

```
webot/                            # 主应用目录（Tauri 子项目）
├── src/                          # React 前端
│   ├── App.tsx                   → 布局编排（状态管理 + 组件组合）
│   ├── App.css                   → CSS 主题通过 [data-theme="dark"] 切换
│   ├── i18n.tsx                  → 国际化 Context（中/英），useI18n hook
│   ├── hooks/useChatStream.ts    → SSE 事件流 hook，管理消息状态
│   ├── types.ts                  → 共享类型定义（Message, PluginManifest, RoundtableRole）
│   ├── constants.ts              → 角色颜色、图标映射、主题切换
│   ├── utils/                    → 工具函数（image.ts, roundtable.ts）
│   ├── components/               # 功能组件（从 App.tsx 拆分）
│   │   ├── Header.tsx            → 顶部导航栏
│   │   ├── ChatPanel.tsx         → 聊天面板
│   │   ├── Markdown.tsx          → Markdown 渲染
│   │   ├── MarketplaceModal.tsx  → 插件市场
│   │   ├── PluginSidebar.tsx     → 插件侧边栏
│   │   ├── RoundtablePage.tsx    → 圆桌会议全屏页面
│   │   ├── SettingsModal.tsx     → 设置弹窗
│   │   ├── ToolResultCard.tsx    → 工具结果卡片
│   │   ├── WeChatQRModal.tsx     → 微信扫码弹窗
│   │   └── WeChatLogModal.tsx    → 微信消息日志
│   └── main.tsx                  → I18nProvider 包裹 App
├── src-tauri/                    # Rust 后端（Tauri 2.x）
│   └── src/
│       ├── lib.rs                → 注册命令、AppState、系统托盘
│       ├── commands.rs           → 所有 Tauri 命令（含圆桌会议、插件管理）
│       ├── llm.rs                → stream_and_emit + call_llm + stream_llm + chat_with_tools
│       ├── config.rs             → Settings 结构体 + config.json 读写
│       ├── plugins.rs            → 插件清单解析、安装/卸载、市场索引、HTTP 工具调用
│       ├── tools.rs              → 内置工具（weather、roundtable）+ 异步执行分发
│       ├── media.rs              → 微信媒体文件上传（AES-ECB 加密 + CDN）
│       └── main.rs               → 程序入口
├── marketplace/                  → 插件市场本地索引（远程失败时回退）
│   └── index.json
└── config.json                   # 运行时配置（gitignore）

根目录遗留文件（Python 旧实现，不在 Tauri 应用内）:
├── wechat_gateway.py             → Python 微信网关（独立服务）
└── weixin.py                     → 微信工具函数
```

### 前后端通信

前端通过 `@tauri-apps/api` 的 `invoke` / `listen` 与 Rust 后端通信。

**聊天流程**：
```
React → invoke("start_chat", { message, toolIds? })
Rust   → tokio::spawn
       → 有 tools → chat_with_tools() 循环（最多 3 轮，非流式）
       → 无 tools → stream_and_emit()（SSE 流式）
       → emit 事件到前端
React → listen() 接收事件，useChatStream hook 管理状态
```

**圆桌会议流程**：
```
React → invoke("start_roundtable", { topic, roles? })
Rust   → tokio::spawn → execute_roundtable()
       → 无 roles → call_llm() 自动生成角色
       → 多轮讨论，每位角色 stream_llm() 逐字流式输出
       → call_llm() 生成总结
React → listen("roundtable-speaker") 接收每位角色发言
```

**微信流程**：
```
React → invoke("fetch_wechat_qr") → 获取二维码
React → invoke("poll_qr_status") → 轮询扫码状态
React → invoke("start_wechat_listener") → 启动长轮询
Rust   → 长轮询 getupdates → 收到消息 → call_llm() → sendmessage
       → emit("wechat-message"/"wechat-status") 到前端
```

### Tauri 命令

| 命令 | 说明 |
|------|------|
| `start_chat` | SSE 流式聊天，可选 tool_ids 参数启用 tool calling |
| `get_settings` / `update_settings` | 读写配置 |
| `fetch_wechat_qr` / `poll_qr_status` | 微信扫码登录 |
| `save_wechat_token` | 保存微信 token |
| `start_wechat_listener` / `stop_wechat_listener` | 微信消息轮询 |
| `send_media` | 发送媒体文件 |
| `fetch_marketplace` | 获取插件市场索引（远程 + 本地回退） |
| `get_installed_plugins` | 获取已安装插件列表 |
| `install_plugin` / `uninstall_plugin` | 安装/卸载插件 |
| `start_roundtable` | 启动圆桌会议多 agent 讨论 |

### 事件类型

| Event | 说明 |
|-------|------|
| `chat-thinking` | 思维链内容（reasoning_content） |
| `chat-text` | 正文流式内容 |
| `chat-done` | 聊天完成 |
| `chat-error` | 聊天错误 |
| `chat-tool-call` | 工具调用 `{ name, arguments }` |
| `chat-tool-result` | 工具结果 `{ name, result, renderer }` |
| `roundtable-speaker` | 圆桌发言流 `{ round, role, status, delta? }` |
| `roundtable-done` | 圆桌结束 `{ result }` |
| `wechat-message` | 收到微信消息 `{ from, text }` |
| `wechat-status` | 微信连接状态 `{ status, message? }` |

### 配置结构 (config.json)

```json
{
  "provider": { "base_url", "api_key", "model", "verify_ssl", "timeout" },
  "agent": { "system_prompt", "max_context_messages" },
  "wechat": { "base_url", "token", "media_dir" }
}
```

- `config.rs` 用 `#[serde(default)]` 保证向后兼容
- `config.json` 支持多路径查找（当前目录 → ../ → ../../）
- 微信运行时状态持久化到 `config/wechat_state/account.json`
- 已安装插件持久化到 `config/plugins/{id}.json`

## Plugin System

插件系统支持内置工具和外部插件两种模式。

**插件清单结构** (`PluginManifest`)：
- 双语名称/描述（`LocalizedText { zh, en }`）
- 工具定义（OpenAI function calling JSON Schema）
- 可选 `endpoint`：外部插件通过 HTTP POST 调用
- 可选 `slots`：UI 扩展插槽（`tool_result` 渲染器、`page` 页面插槽）
- 可选 `lab` 标记：官方实验性插件

**插件市场**：
- 远程索引：`https://raw.githubusercontent.com/Linmoqian/webot/main/marketplace/index.json`
- 本地回退：`marketplace/index.json`
- 前端 localStorage 缓存已安装状态，右键菜单支持卸载

**工具执行分发** (`tools.rs`)：
- 内置工具：`weather`（mock）、`roundtable`（多 agent 讨论）
- 外部插件：通过 `endpoint` URL POST 参数，返回结果

## Roundtable (圆桌会议)

多 agent 讨论功能，由 `tools.rs::execute_roundtable` 实现：
- 自动或手动分配 3-4 位专家角色
- 2 轮讨论，每位角色独立调用 LLM（`stream_llm` 流式输出）
- 最终调用 LLM 生成讨论总结
- 前端专属全屏页面，角色卡片彩色头像区分、拖拽排序
- 讨论历史持久化到 localStorage，支持回看和删除

## System Tray

系统托盘（`lib.rs` setup）：
- 关闭窗口 → 隐藏到托盘而非退出
- 左键单击托盘图标 → 显示窗口
- 右键菜单：显示主窗口 / 退出

## Key Technical Details

- Rust 后端用 `reqwest` + `futures_util` 处理 SSE 流式响应
- `stream_llm()` 通用 SSE 函数：支持自定义事件名和附加 payload（圆桌复用）
- `chat_with_tools()` 循环最多 3 轮 tool calling，支持内置 + 外部插件工具
- 支持 `reasoning_content` 字段（思维链），前端可折叠展示
- 前端 Markdown 渲染：react-markdown + remark-gfm + remark-math + rehype-highlight + rehype-katex
- 微信媒体上传：`media.rs` 实现 AES-128-ECB 加密 + CDN 上传，支持图片/视频/语音/文件
- `[media: filename]` 标记：LLM 回复中的标记会被解析为媒体文件发送
- 微信长消息自动拆分（4000 字符上限，按换行符断行）
- 微信"正在思考..."即时回复 + typing 指示器
- 调试信息总线：`window.webotDebugBus` 向浏览器发送调试事件
- 国际化：`i18n.tsx` 提供 Context + `useI18n()` hook，偏好存 localStorage
- 主题：CSS `[data-theme="dark"]` 选择器，偏好存 localStorage
- Tauri features：`protocol-asset`（本地图片展示）、`tray-icon`（系统托盘）
- `danger_accept_invalid_certs(true)` 用于开发环境跳过 SSL 验证
- 前端图标库：lucide-react
- 前端类型集中定义在 `types.ts`，常量在 `constants.ts`
