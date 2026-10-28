# Agent Note: Bash 只读策略是审批瀑布之下的固定移植

Status: implemented

[English](2026-10-28-bash-readonly-policy-port.md) | 中文

## 问题

审批摩擦对 `git status` 与 `rm -rf` 一视同仁，除非部署放宽整个 preset。ZCode 维护着一个纯静态分析器（约 3.3k 行：基于 `unbash` 的 argv 解析、逐命令 flags 表、git/gh 子命令目录、危险词匹配器），无需执行即可判定 Bash 命令只读。把它移植进 DSH 需要一个位置，使判定始终只是审批决策的输入——绝不是沙箱旁路——并为整份上游拷贝给出覆盖率故事。

## 决策

### 库是 `guard/bash-readonly-policy/src/lib` 下的固定移植

ZCode 分析器文件仅做导入扩展名适配后拷贝，外加本地补充（`env` 仅赋值规则；exactOptionalPropertyTypes 修复）。`unbash` 固定在上游测试过的 `4.0.1`。公共表面是 `classifyBashReadonly(command): ReadonlyVerdict`：一条命令的每个管道/列表成员都必须判定只读；任何不安全分析、写选项、重定向、动态词、与目录变更同行的 `git`、目录外命令，都以稳定原因 token fail-closed 到 `unknown`。分类器只读命令字符串——不碰文件系统、不执行。

### 判定喂给 `tools/pre-execute`，从不取代 guards

一个前置监听器：开启 `autoApproveReadonly`（默认关闭——按部署 opt-in，绝非全局默认）时，只读命令直接放行且不下传，其下游的询问者不再加摩擦；开启 `audit` 时，下游的 allow 转为 ask，其 `displayReason` 携带判定。未知命令始终原样下传，沙箱、guards 与超时包装对每个决策都在链上。

### 覆盖率把关行为而非上游内部

`src/lib/**` 从逐分支覆盖率中排除，理由记录在 `vitest.config.ts`：corpus 与性质测试（移植的 ZCode 用例加 DSH 补充，200+ 命令，写词汇在引号包装下零漏报）把关可观察契约，而对移植代码的逐分支覆盖只会重建上游自己的内部测试套件。`classify.ts` 与 `index.ts` 仍受逐文件 100% gate 约束。

## 影响

- 即使运行期检查可能放行，与 `cd` 同行的 `git` 仍保持未知：字符串-only 契约正是 corpus 证明的安全边界。
- 类别计数走 debug 日志与卸载汇报；会话遥测只镜像会话事件，没有插件计数通道。
- 把插件行加入 `dsh-base` 后，所有 shipped profile 都会挂载它；默认配置保持惰性。

## 备选方案

- **全新更小的分类器**：丢失移植携带的久经考验的目录与边界用例；PRD 明确要求移植。
- **由 presets 承载 opt-in**：今天的 presets 只持有沙箱与审批两个旋钮；插件 Config 让策略开关随策略走，直到 presets 长出 readonly 槽位。
- **对 `src/lib/` 做完整逐分支覆盖**：数周的上游测试重移植，相对 corpus 并无额外行为保证。
