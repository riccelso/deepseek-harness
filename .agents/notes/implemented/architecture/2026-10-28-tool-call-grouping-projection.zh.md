# Agent Note: 同名工具聚合行是摘要注册表之上的渲染级投影

Status: implemented

[English](2026-10-28-tool-call-grouping-projection.md) | 中文

## 问题

长 agent 轮次会产生数十次同名工具的连续调用。每次调用各占一行，使流程分组主体成为重复卡片堆砌的高墙，而外层流程分组本已收起整轮。收起同名工具连续调用需要逐工具的摘要知识（路径、diff 统计、命令、退出结论），Chat 渲染器并不拥有这些知识；同时它不能改动持久会话日志，也不能占用会话分组引擎——后者已经占用了每个目标唯一的 Group Definition 席位。

## 决策

### 摘要注册表位于 `ctx.uiConversation.toolGroups`

`UiConversation` 拥有按工具线名索引的 `ToolGroupSummaryRegistry`。一次注册提供纯函数 `summarize(block, cwd)` 的单次调用摘要，以及本地化的 `unit(count)` 数量标题。提供方在插件加载时注册（`ui-tool` 注册 edit、write、bash、pwsh、read，复用卡片已有的终端状态解析与路径缩写）；没有提供方的工具永不聚合，因此自带渲染器的自定义工具在构造上不受影响。工具知识留在工具包，会话词汇留在 `ui-conversation` 的 locale 命名空间，渲染留在 `ui-chat`，不产生跨 feature 插件的运行时引用。

### 分组是分组引擎之下的纯投影，不是第二台分组引擎

`planToolRuns` 将一个分组的成员列表分段为单一引用和达到阈值的同名工具段。它运行在 `ChatGroupSeat` 的成员渲染内部，位于已拥有根排序的 `ConversationGroupDefinition` 之下。事件日志、分组引擎输出和持久 transcript 均不受影响：关闭偏好即可从相同成员恢复此前的一调用一行渲染，重载后从相同节点确定性重建相同分段。

### 聚合行跟随共享默认值并支持逐行覆盖

每个聚合行拥有显式覆盖；无覆盖的行跟随共享的 `{ all, generation }` 存储，因此一个快捷键（`chat.toolGroups.toggleAll`，仅在可选的 `shortcuts` 服务存在时注册）可一次翻转全部聚合行。`generation` 递增使过期覆盖失效。快捷键注册使用可选 `ctx.inject`，没有注册表的组合仍保留 Chat 的其余贡献；静态依赖会破坏组装式 Web 启动。

### 偏好沿用现有 Chat 设置表单

`toolGrouping`（开/关）与 `toolGroupThreshold`（2/3/5/10）通过 `ui-chat` 配置表单持久化，与工作细节偏好并列，并为流程的成员渲染派生身份稳定的快照。

## 影响

- 聚合行在展开前隐藏逐行操作；失败调用保留跳转到成员的徽标，收起时错误仍可达。
- 统计可见工具行的 Web 场景 golden 需先展开流程分组再展开聚合行（`expandToolGroups` 从最后一个匹配向内遍历，因为展开一行会把它从 `aria-expanded="false"` 选择器集合中移除）。
- 注册表是启动期的：后续注册不会重新规划已渲染的成员。

## 备选方案

- **为工具段新建第二个 `ConversationGroupDefinition`**：引擎每个目标只允许一个 Group Definition，`chat` 已占其席位；组内子分组不是引擎概念，段将被迫成为根条目并重新实现流程分组已拥有的排序。
- **在 `ui-chat` 内硬编码工具族**：Chat 渲染器需要复制 `ui-tool` 拥有的工具模型推导（命令/退出解析、路径缩写），跨越导出纪律禁止的 feature 插件边界。
- **用键控 slot 而非注册表提供摘要**：分组决策必须发生在渲染前，而 slot 只在渲染时解析；服务注册表为投影提供同步查找。
