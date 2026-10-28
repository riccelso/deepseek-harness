# 侧问

[English](btw.md) | 中文

由 [`@deepseek-ai/dsh-experimental-btw`](../../packages/experimental/btw/README.zh.md) 拥有、经 [`@deepseek-ai/dsh-experimental-api-btw`](../../packages/experimental/api-btw/README.zh.md) 暴露给浏览器的 `/btw` 旁问能力。旁问只凭会话已有的内容作答：引擎以禁用全部全局工具的方式 fork 会话的常驻 Agent，作答子代理因此继承会话已完成轮次的前缀并运行一个无工具轮次。问答与保留字段由[引擎 README](../../packages/experimental/btw/README.zh.md) 拥有；浏览器标签页是 [client-ui-btw](../../packages/experimental/client-ui-btw/README.zh.md)。

## 隔离保证

fork 子代理是一个普通的持久子会话；旁问内容绝不进入父会话。父 Session 日志不会因一次提问新增任何 `user/message` 或 `tool/result` —— 只有命名子代理的标准 `subagent/catalog` 事实（仅 id 与固定标签，绝无问题或答案），且父会话的下一个模型请求与没有旁问时逐字节一致。保留的问答存放在 Host 上按 Session 划分的内存环中；浏览器重载可恢复，Host 重启即丢弃。

## 服务行为

`ctx.btw.ask(sessionId, question, signal, images?)` 解析父 Agent（必须常驻，空闲即可），经附件存储接纳图片，再以 `toolFilter: { allow: [] }` 与 caller 交付启动一个 `fork` 激活。调用方取消或配置的期限会销毁激活，从而停止子代理。激活的结果文本即答案；子会话最后一条带 usage 的 assistant 消息与最后一个请求头给出卡片的 token 成本与路由，仅作装饰。`ctx.btw.history` 读取环形缓冲；`ctx.btw.clear` 丢弃它。Remote 门面 `ctx.btwController` 为浏览器客户端镜像这三个操作，并把 ask 失败包装为一个稳定的 `btw/ask-failed` RemoteError。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbtw--btwsidequestions"></a>

### `ctx.btw` — `BtwSideQuestions`

The side-question engine. Forks a Session's resident agent with every global tool denied, resolves the answer from the child activation's result, and retains the exchanges of every addressed Session in memory.

```ts cordis-catalog
/**
 * Answer one side question by forking the Session's resident agent with
 * every global tool denied.
 * @param sessionId - Session the question is about; its agent must be resident.
 * @param question - trimmed side question.
 * @param signal - caller cancellation; aborts the fork child and discards the exchange.
 * @param images - canonical-base64 images to admit and attach to the question.
 * @returns the completed exchange, also recorded in this Session's ring.
 * @throws when the question is empty or too long, the Session has no resident
 * agent to fork, an image is rejected by the attachment store, or the fork
 * ends without a text answer.
 */
async ask( sessionId: SessionId, question: string, signal: AbortSignal, images: readonly EncodedImageAttachment[] = [], ): Promise<BtwExchange>

/**
 * Read the retained exchanges of one Session.
 * @param sessionId - Session whose ring is read.
 * @returns retained exchanges in log order and the count of evicted older ones.
 */
history(sessionId: SessionId): BtwHistory

/**
 * Discard every retained exchange of one Session.
 * @param sessionId - Session whose ring is cleared.
 */
clear(sessionId: SessionId): void
```

Types: [EncodedImageAttachment](attachment.zh.md) · [SessionId](core.zh.md)

Source: [`packages/experimental/btw/src/index.ts`](../../packages/experimental/btw/src/index.ts)

<a id="ctxbtwcontroller--btwcontroller"></a>

### `ctx.btwController` — `BtwController`

Side questions never activate or submit to an Agent.

```ts cordis-catalog
/**
 * Answer one side question about a Session from what it already contains.
 * @param sessionId - Session the question is about.
 * @param question - side question exactly as asked.
 * @param images - canonical-base64 images to attach to the question.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns the completed exchange without adding a Session event.
 */
@Remote async ask( sessionId: SessionId, question: string, images: readonly EncodedImageAttachment[], signal: AbortSignal, ): Promise<BtwExchange>

/**
 * Read the retained side-question exchanges of one Session.
 * @param sessionId - Session whose retained exchanges are read.
 * @returns retained exchanges in log order and the count of evicted older ones.
 */
@Remote history(sessionId: SessionId): BtwHistory

/**
 * Discard every retained exchange of one Session.
 * @param sessionId - Session whose retained exchanges are cleared.
 */
@Remote clear(sessionId: SessionId): void
```

Types: [EncodedImageAttachment](attachment.zh.md) · [SessionId](core.zh.md)

Source: [`packages/experimental/api-btw/src/index.ts`](../../packages/experimental/api-btw/src/index.ts)
<!-- END GENERATED cordis-surface -->
