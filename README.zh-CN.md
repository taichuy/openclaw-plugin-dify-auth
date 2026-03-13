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

## 📦 安装与配置

### 1. 安装插件

```bash
openclaw plugins install @taichuy/dify-auth
```

### 2. 启用插件

```bash
openclaw plugins enable dify-auth
```

### 3. 配置登录

```bash
openclaw models auth login --provider dify
```

> ⚠️ **注意**：由于 Dify 官方的 PR 还没有通过，暂时无法直接合并进 OpenClaw 官方仓库，因此无法直接在 OpenClaw 默认大模型供应商列表中看到 Dify。需要通过上述命令手动配置登录。

在配置过程中：
1. 填入你的 **API Key**。
2. 将 **API URL** 修改为你的本地部署地址（默认为 Dify 云端地址，但目前云端尚未支持此特性，只能使用私有部署版本）。

## ⚠️ 前置要求（Dify 改造版）

你需要部署支持 OpenClaw 协议的 Dify 修改版。源码及分支如下：

- 🔗 **GitHub**: [JAVA-LW/dify](https://github.com/JAVA-LW/dify)
- 🌿 **Branch**: [taichuy_dev](https://github.com/JAVA-LW/dify/tree/taichuy_dev)

### 🤝 社区支持（求助攻！）

因为 Dify 社区会优先处理热门讨论，请大家帮忙把热度顶起来，争取早日合并进官方主线！

- 💬 **Dify 仓库讨论区**: [GitHub Discussion #33118](https://github.com/langgenius/dify/discussions/33118)
- 📝 **Dify 官方论坛**: [Feature Proposal](https://forum.dify.ai/t/feature-proposal-openai-tool-callback-protocol-support-for-chatflow-openclaw-integration/1321)
- 📺 **B 站演示视频**: [OpenClaw 接入 Dify 效果演示](https://www.bilibili.com/video/BV1GHcSzLE8w/?vd_source=14f5bffd70917e87600d91f6eade14f8)

我们正在积极推动将此能力合并回 Dify 官方主线，详情见：
- PR: [langgenius/dify#32296](https://github.com/langgenius/dify/pull/32296)

- Discussion: [langgenius/dify discussion #33118](https://github.com/langgenius/dify/discussions/33118)

