---
description: "旁问引擎之上的已认证 Remote 门面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-api-btw

[English](README.md) | 中文

## 概述

此 TypertRemoteService 在 `btw` Remote 命名空间上暴露 `ask`、`history` 与 `clear`。旁问从不向会话自身的 Agent 提交，也不向其日志新增消息或工具结果。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

通过 [btw bundle](../btw-bundle/README.zh.md) 加载。浏览器端挂载 `./remote` 贡献并调用 `ctx.remote.btw.ask(sessionId, question, images, signal)`——`images` 是规范 base64 的图片附件；失败的调用表现为一个 `btw/ask-failed` RemoteError，其 `details.reason` 携带引擎的诊断信息。

<a id="understand-the-implementation"></a>
## 理解实现

每个方法校验取消状态后委托给 [btw](../btw/README.zh.md) 的 `ctx.btw`，并把 ask 失败包装为一个稳定的 RemoteError；history 与 clear 是同一引擎上的同步读取。

<a id="further-exploration"></a>
## 进一步探索

挂载此贡献的浏览器半边是 [client-ui-btw](../client-ui-btw/README.zh.md)。

<a id="dev-note"></a>
## 开发备注

`lib/typert.*` 产物由 `scripts/generate-typert.ts` 生成。

<a id="model-experience"></a>
## 模型体验

此包不进入模型上下文；它只把旁问传输给引擎。

#### KV Cache effect

无。Remote 不新增模型请求；引擎的一次辅助调用在它自己的包中说明。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 流式作答延后；每次 ask 返回一个完成的问答。
