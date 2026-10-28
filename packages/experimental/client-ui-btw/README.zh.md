---
description: "/btw 的浏览器半边：接管输入行的 '/' 源，以及带 Markdown 作答、图片附加与语音转写的右侧边栏标签页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-btw

[English](README.md) | 中文

## 概述

此浏览器半边注册 `btw` '/' 源与右侧边栏的旁问标签页。输入 `/btw 问题` 后回车会接管整行——不提交任何内容——并把这页并行对话展示出来；单独的 `/btw` 展示空输入的标签页。每次提问是独立状态的卡片：生成中（带取消按钮）、已取消、出错，或完成并显示 token 成本、复制、“插入到对话”（答案成为主输入框未发送的草稿）与丢弃。回答以 Markdown 渲染；输入框可附加图片，并在已挂载语音 Remote 时把录音转写为草稿文本。卡片进行中输入框仍可用，多条提问可并行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

通过 [btw bundle](../btw-bundle/README.zh.md) 加载。本窗口的卡片呈现在同一份可滚动记录中——问题是气泡，回答是带逐卡片操作的全文——下方是固定输入框；Escape 关闭标签页，Enter 提问，携带附件的行会被拒绝并提示，草稿保持不变。重新加载后卡片由引擎保留的历史重建；取消与丢弃只作用于本窗口，从不触碰 Host 的环形缓冲。

<a id="understand-the-implementation"></a>
## 理解实现

`mount.ts` 挂载 [api-btw](../api-btw/README.zh.md) 的 Remote 贡献，在快照存储中为每个 Session 保存一个面板条目，注册 '/' 源（跳过子代理会话），并注册右侧边栏标签页类型与其键控主体。源的 `matchEnter` 在打开面板状态并展示标签页后返回 `handled`，提交状态机因此清空草稿且不发送。每次提问追加一张由自己的 AbortController 驱动的卡片——取消只把该卡片标记为已取消并只停止那个 fork——“插入到对话”解析会话绑定的 conversation input 来设置草稿并聚焦输入框。

<a id="further-exploration"></a>
## 进一步探索

作答引擎是 [btw](../btw/README.zh.md)。

<a id="dev-note"></a>
## 开发备注

入口导入生成的 Remote 贡献；Web 回放测试覆盖构建后的入口，源测试覆盖斜杠源。

<a id="model-experience"></a>
## 模型体验

此包不进入模型上下文；被接管的 /btw 行永远不会变成提示词。

#### KV Cache effect

无。从面板打开或提问都不新增会话请求；作答调用属于引擎，不属于会话。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 回答一次性返回（无流式）。
- 标签页不保留各会话的键盘历史。
- 卡片只属于本窗口；重新加载后仅完成的问答从 Host 环形缓冲重建。
- 麦克风仅在别的 bundle（如 voice-input）挂载语音 Remote 时出现；图片走基础附件存储。
