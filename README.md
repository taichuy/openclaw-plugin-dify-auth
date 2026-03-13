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

## 📦 Installation & Configuration

### 1. Install Plugin

```bash
openclaw plugins install @taichuy/dify-auth
```

### 2. Enable Plugin

```bash
openclaw plugins enable dify-auth
```

### 3. Configure Auth

```bash
openclaw models auth login --provider dify
```

> ⚠️ **Note**: Since the official Dify PR has not been merged yet, it cannot be directly included in the OpenClaw official repository. Therefore, Dify does not appear in the default LLM provider list, and you need to manually configure the login using the command above.

During configuration:
1. Enter your **API Key**.
2. Change the **API URL** to your local deployment address (default is Dify Cloud, but the feature is not yet supported there, so you must use a private deployment).

## ⚠️ Prerequisites (Modified Dify)

You need to deploy a modified version of Dify that supports the OpenClaw protocol.

- 🔗 **GitHub**: [JAVA-LW/dify](https://github.com/JAVA-LW/dify)
- 🌿 **Branch**: [taichuy_dev](https://github.com/JAVA-LW/dify/tree/taichuy_dev)

### 🤝 Community Support

We need your help to get this merged into the official Dify mainline! Please upvote and discuss:

- 💬 **GitHub Discussion**: [langgenius/dify#33118](https://github.com/langgenius/dify/discussions/33118)
- 📝 **Dify Forum**: [Feature Proposal](https://forum.dify.ai/t/feature-proposal-openai-tool-callback-protocol-support-for-chatflow-openclaw-integration/1321)
- 📺 **Demo Video**: [OpenClaw & Dify Integration Demo](https://www.bilibili.com/video/BV1GHcSzLE8w/?vd_source=14f5bffd70917e87600d91f6eade14f8)

We are actively working to merge this capability into the official Dify mainline:
- PR: [langgenius/dify#32296](https://github.com/langgenius/dify/pull/32296)

- Discussion: [langgenius/dify discussion #33118](https://github.com/langgenius/dify/discussions/33118)
