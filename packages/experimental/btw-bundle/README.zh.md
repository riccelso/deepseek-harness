---
description: "组合 /btw 旁问引擎、Remote 与浏览器标签页的可选 bundle；回答来自会话的一个无工具 fork。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-btw-bundle

[English](README.md) | 中文

## 概述

此可选 bundle 组合 [btw](../btw/README.zh.md)、[api-btw](../api-btw/README.zh.md) 与 [client-ui-btw](../client-ui-btw/README.zh.md)：`/btw <问题>` 在一个永不进入 Session 日志的右侧边栏标签页中，仅凭当前对话作答。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在插件页启用此 bundle。输入 `/btw <问题>` 并回车——整行被接管，不提交任何内容，右侧边栏展示旁问标签页并以 Markdown 渲染回答。单独的 `/btw` 展示该标签页与最新问答。每次提问是独立的卡片：进行中可取消、多条可并行，完成的卡片显示 token 成本并提供“插入到对话”，把答案作为未发送的草稿放进主输入框。标签页输入框可为问题附加图片（不支持视觉的路由会让该次提问以 fork 的错误失败）；装了语音能力的 bundle 后还能把录音转写进草稿。引擎的 `provider` 与 `model` 固定作答子代理的路由；两者都省略时继承每个会话自己的模型。

<a id="understand-the-implementation"></a>
## 理解实现

`cordis.patch.yml` 以引擎默认策略插入三行运行时（1024 输出 token、120 秒期限、保留 20 条问答）。引擎通过已组合的 subagent 运行时 fork；作答子代理继承对话并禁用全部全局工具。

<a id="further-exploration"></a>
## 进一步探索

各成员包分别记录自己的半边；`docs/DETAIL.md` 是面向用户的详情页。

<a id="dev-note"></a>
## 开发备注

图标是原创的对话气泡问号；未捆绑字体或第三方素材。

<a id="model-experience"></a>
## 模型体验

对父 Session 没有影响：旁问内容从不进入其上下文或日志（只有一条命名 fork 的子代理 catalog 事实）。作答 fork 子代理是独立请求流上的一次独立 Agent 轮次。

#### KV Cache effect

对父 Session 的请求流没有影响。fork 子代理在自身首次请求中重发继承的前缀，从不触碰会话的提示缓存。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 回答一次性返回，没有流式。
- 保留在内存中，Host 重启即清空（持久的 fork 子代理保留自己的日志）。
- 会话的 Agent 必须常驻才能 fork；已销毁的 Agent 拒绝旁问。
- 并发提问共享子代理容量。
