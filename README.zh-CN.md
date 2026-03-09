# OpenClaw Dify Auth Plugin

[English](./README.md)

这是一个 OpenClaw 插件，用于连接 [Dify](https://dify.ai) 应用。它不仅处理与 Dify API 的认证和通信，核心功能是**让 Dify 应用能够调用 OpenClaw 本地的工具函数**（Tool/Function Calling）。

## ✨ 核心特性

- **Dify 连接器**：作为 OpenClaw 的 Provider 接入，支持配置 Dify API Key 和 Base URL。
- **工具赋能**：将 OpenClaw 强大的本地工具生态（文件操作、系统命令、MCP 插件等）暴露给 Dify 的 LLM 使用。
- **双向交互**：
  1. 用户在 OpenClaw 发送消息 -> 转发给 Dify。
  2. Dify 决策需要调用工具 -> 返回 tool_call 指令给 OpenClaw。
  3. OpenClaw 执行本地工具 -> 将结果回传给 Dify。
  4. Dify 根据工具结果生成最终回答。

## 📦 安装

```bash
openclaw plugins install @taichuy/dify-auth
```

## ⚠️ 前置要求

由于 Dify 官方尚未完全支持这种“客户端执行工具并回传结果”的协议（类似 OpenAI 的 tool_choice 流程），你需要使用支持该特性的 Dify 修改版。

请使用以下 Fork 的 `taichuy_dev` 分支部署你的 Dify 实例：

- 🔗 **GitHub**: [taichuy/dify (branch: taichuy_dev)](https://github.com/taichuy/dify/tree/taichuy_dev)

我们正在积极推动将此能力合并回 Dify 官方主线，详情见：
- PR: [langgenius/dify#32296](https://github.com/langgenius/dify/pull/32296)
- Discussion: [langgenius/dify discussion #33118](https://github.com/langgenius/dify/discussions/33118)

