---
description: "旁问引擎：以一个禁用全部工具的 fork 子代理，仅凭会话继承的对话内容作答。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-btw

[English](README.md) | 中文

## 概述

此 Service Definition 通过 fork 会话的常驻 Agent（禁用其全部全局工具）来回答一条 `/btw` 旁问。fork 子代理继承会话已完成轮次的前缀，因此答案只使用该 Session 已有的内容。它从不向父 Agent 提交，也不向父 Session 日志追加任何消息或工具结果；每次问答保存在按 Session 划分的内存环中，而子代理自身的日志是一个普通的持久子会话。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

通过 [btw bundle](../btw-bundle/README.zh.md) 加载。会话的 Agent 必须常驻（空闲即可）：fork 继承其来源、谱系与路由。`provider` 与 `model`（成对设置）覆盖子代理路由；两者都省略时子代理沿用父 Agent 的选项。`maxOutputTokens` 限制作答轮次，`timeoutMs` 限制整次旁问，`historyLimit` 保留每个 Session 的问答，`questionMaxLength` 在任何 fork 启动之前拒绝过长的问题。

<a id="understand-the-implementation"></a>
## 理解实现

`ask` 通过 `agents` 解析父 Agent，经附件存储的批量限制接纳编码图片，再通过 `subagents` 启动一个 `fork` 激活，携带 `toolFilter: { allow: [] }`（禁用全部全局工具）并按 caller 交付。子代理的用户提示组帧作答指令、保留的历史旁问（它们不属于对话本身）、问题与已接纳的图片。激活的结果给出文本答案；子会话最后一条带 usage 的 assistant 消息与最后一个请求头给出卡片的 token 成本与路由，经 `sessionQuery` 读取，仅作装饰。调用方取消或超时会销毁激活并停止子代理；环形缓冲只记录成功的问答。

<a id="further-exploration"></a>
## 进一步探索

此引擎的 Remote 门面是 [api-btw](../api-btw/README.zh.md)；浏览器半边是 [client-ui-btw](../client-ui-btw/README.zh.md)。

<a id="dev-note"></a>
## 开发备注

提示组帧与账务提取是纯函数并导出供测试；服务在每次 ask 之外不持有任何 Session 句柄。父 Session 只增加一条命名子代理的 subagent catalog 事实——绝不包含问题或答案。

<a id="model-experience"></a>
## 模型体验

对父 Session 没有影响：任何 `/btw` 内容都不进入其上下文，其下一次请求与没有旁问时逐字节一致。作答子代理是独立请求流上的一次独立 Agent 轮次。

#### KV Cache effect

对父 Session 的缓存没有影响。fork 子代理在自身首次请求中重发继承的前缀，不预热也不复用父会话的提示缓存。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 环形缓冲在内存中，Host 重启即丢弃。子会话本身是持久的，问答内容只存在于那里，从不进入父日志。
- 答案是一次性的；流式延后。
- 图片会被接纳，但不会重放进历史旁问组帧；只保留数量标记。
- 并发旁问共享子代理容量（`maxActiveSubagents`）；超出后 ask 被拒绝直到有空位。
- 父日志为每个 fork 记录一条 `subagent/catalog` 事实（仅 id 与固定标签，无旁问内容）。
