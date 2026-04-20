# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目目标

超轻量化的 Agent 框架。核心循环：调用 LLM → 解析工具 → 执行 → 回传结果。

## 设计原则

- 简洁小巧，避免过度抽象
- 模块化，每个组件职责单一

## 规划架构

| 模块 | 职责 |
|------|------|
| agent | Agent 核心循环：LLM 调用、工具解析、执行、回传 |
| providers | LLM 提供商适配层（OpenAI、Anthropic 等） |
| skills | 工具/技能定义与注册 |
| config | 配置管理 |
| session | 会话状态管理（上下文、历史） |
| CLI | 命令行交互界面 |
