# OpenClaw Dify Auth Plugin

[简体中文](./README.zh-CN.md)

This is an OpenClaw plugin for connecting to [Dify](https://dify.ai) applications. It handles authentication and communication with the Dify API, with the core capability of **enabling Dify applications to invoke OpenClaw's local tools** (Tool/Function Calling).

## ✨ Features

- **Dify Connector**: Integrates as an OpenClaw Provider, supporting Dify API Key and Base URL configuration.
- **Tool Empowerment**: Exposes OpenClaw's powerful local tool ecosystem (file operations, system commands, MCP plugins, etc.) to Dify's LLM.
- **Bi-directional Interaction**:
  1. User sends message in OpenClaw -> Forwarded to Dify.
  2. Dify decides to call a tool -> Returns `tool_call` instruction to OpenClaw.
  3. OpenClaw executes the local tool -> Sends result back to Dify.
  4. Dify generates the final response based on the tool result.

## 📦 Install

```bash
openclaw plugins install @taichuy/dify-auth
```

## ⚠️ Prerequisites

Since Dify officially does not yet fully support this "client-side tool execution and result callback" protocol (similar to the OpenAI tool_choice flow), you need to use a modified version of Dify.

Please deploy your Dify instance using the `taichuy_dev` branch from this fork:

- 🔗 **GitHub**: [taichuy/dify (branch: taichuy_dev)](https://github.com/taichuy/dify/tree/taichuy_dev)

We are actively working to merge this capability into the official Dify mainline:
- PR: [langgenius/dify#32296](https://github.com/langgenius/dify/pull/32296)
- Discussion: [langgenius/dify discussion #33118](https://github.com/langgenius/dify/discussions/33118)
