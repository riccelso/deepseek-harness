---
description: "对 Bash 命令做静态只读判定并接入审批瀑布：可选择自动放行只读命令，审计模式在审批卡上展示判定结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bash-readonly-policy

[English](README.md) | 中文

## 概述

仅凭命令文本将一条 Bash 命令行判定为只读或未知——ZCode 的 argv/flags/git/gh 分析库的纯移植——并把判定结果送入 `tools/pre-execute` 瀑布：可选的只读命令自动放行，以及继续询问但在审批卡上展示判定的审计模式。构造上 fail-closed，绝不是沙箱旁路。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用本包

- 在只读命令审批摩擦明显的场景挂载；它随 `dsh-base` 发布。
- 设置 `autoApproveReadonly: true`，静态只读命令无需询问即可放行（沙箱与其他所有 guard 保持生效）。
- 设置 `audit: true`，只读命令继续询问，并在审批卡上展示静态分析判定。
- 需要 pure 判定时直接导入 `classifyBashReadonly`。

## 理解实现

`src/classify.ts` 遍历一条命令解析出的每个片段：管道或列表的所有成员都必须判定只读；任何不安全的分析、写选项、重定向、动态词（`$(...)`、反引号、参数展开）、与目录变更同行的 `git`、目录外的命令，都以稳定的原因 token fail-closed 到 `unknown`。`src/analyzer/` 是固定版本的 ZCode 分析库（基于 `unbash` 的 argv 解析、逐命令 flags 表、git/gh 子命令目录、危险词匹配器），外加本地补充（`env` 仅允许赋值）。

插件前置一个 `tools/pre-execute` 监听器：开启 opt-in 时对只读命令直接 `allow` 且不再下传；审计模式下把下游的 allow 转为 ask，其 `displayReason` 携带判定。每个决策都以原因记录 debug 日志；类别计数（绝不含命令文本）在卸载时汇报。

## 开发备注

判定刻意只读命令字符串——不碰文件系统、不执行——因此与 `cd` 同行的 `git` 和所有动态展开即使运行期检查可能放行，也保持未知。类别计数走 debug 日志，因为会话遥测只镜像会话事件。

## 模型体验

### 只影响审批摩擦

#### 模型看到什么

本插件不新增 prompt 或 schema。开启 `autoApproveReadonly` 时，只读自动放行的执行与人工放行完全一致；开启 `audit` 时，询问通过现有审批卡到达模型，判定结果随 display reason 展示。未知命令走不变的 `tools/pre-execute` 流水线。

#### Token 影响

零 token：判定只移除或保留一次审批往返，不改变任何结果内容。

#### KV Cache 影响

无。审批决策发生在执行之前；请求流与 prompt cache 均不受影响。

## 已知限制与延期工作

- `env` 规则仅允许赋值与 `--`；`env -i` 一类 flags 在编入目录前保持未知。
- 类别计数走 debug 日志，未导出到会话遥测。
- `pwsh` 不在范围内；目录面向 POSIX Bash。
- 移植的 `src/analyzer/` 内部实现未纳入逐分支覆盖率；行为由 corpus 与性质测试把关（见 `vitest.config.ts`）。
